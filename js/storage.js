import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.103.0/+esm";
import { createInitialState, MEMBER_STATUSES, normalizeState, ROLE_TYPES } from "./constants.js";

const LOCAL_STATE_KEY = "phi-rho-election-state-v2";
const LOCAL_MEMBERS_KEY = "phi-rho-election-members-v2";
const LOCAL_VOTES_KEY = "phi-rho-election-votes-v2";
const LOCAL_SESSIONS_KEY = "phi-rho-election-sessions-v2";
const LOCAL_SESSION_TOKEN_KEY = "phi-rho-election-session-token-v2";
const PRESIDENT_EMAIL = "president.psr.rho@gmail.com";
const ONLINE_WINDOW_MS = 2 * 60 * 1000;

function readJson(key, fallbackValue) {
  try {
    const rawValue = window.localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : fallbackValue;
  } catch (error) {
    return fallbackValue;
  }
}

function writeJson(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeName(name = "") {
  return String(name).trim().replace(/\s+/g, " ").toLowerCase();
}

function randomId(prefix) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random()}`;
}

function activeWithinWindow(isoString) {
  if (!isoString) {
    return false;
  }

  return Date.now() - new Date(isoString).getTime() <= ONLINE_WINDOW_MS;
}

function publicMember(member, sessions = []) {
  const isOnline = sessions.some(
    (session) =>
      session.member_id === member.id &&
      !session.revoked_at &&
      activeWithinWindow(session.last_seen_at),
  );

  return {
    id: member.id,
    login_name: member.login_name,
    display_name: member.display_name,
    role: member.role,
    member_status: member.member_status,
    contact_email: member.contact_email || null,
    is_online: isOnline,
  };
}

function sortMembers(members) {
  return [...members].sort((left, right) => {
    if (left.is_online !== right.is_online) {
      return left.is_online ? -1 : 1;
    }

    if (left.role !== right.role) {
      return left.role === ROLE_TYPES.president ? -1 : 1;
    }

    return left.display_name.localeCompare(right.display_name);
  });
}

function validateCredentials(name, password) {
  if (!name.trim()) {
    throw new Error("Enter your name.");
  }

  if (password.trim().length < 6) {
    throw new Error("Use a password with at least 6 characters.");
  }
}

export class LocalElectionService {
  constructor() {
    this.mode = "local";
    this.label = "Local demo mode";
    this.requiresAuth = false;
    this.state = normalizeState(readJson(LOCAL_STATE_KEY, createInitialState()));
    this.members = readJson(LOCAL_MEMBERS_KEY, []);
    this.votes = readJson(LOCAL_VOTES_KEY, {});
    this.sessions = readJson(LOCAL_SESSIONS_KEY, []);
    this.sessionToken = window.localStorage.getItem(LOCAL_SESSION_TOKEN_KEY) || null;
    this.profile = null;
  }

  persistCollections() {
    writeJson(LOCAL_STATE_KEY, this.state);
    writeJson(LOCAL_MEMBERS_KEY, this.members);
    writeJson(LOCAL_VOTES_KEY, this.votes);
    writeJson(LOCAL_SESSIONS_KEY, this.sessions);
  }

  clearSessionToken() {
    this.sessionToken = null;
    this.profile = null;
    window.localStorage.removeItem(LOCAL_SESSION_TOKEN_KEY);
  }

  async init() {
    this.state = normalizeState(readJson(LOCAL_STATE_KEY, this.state));
    this.members = readJson(LOCAL_MEMBERS_KEY, this.members);
    this.votes = readJson(LOCAL_VOTES_KEY, this.votes);
    this.sessions = readJson(LOCAL_SESSIONS_KEY, this.sessions);
    this.sessionToken = window.localStorage.getItem(LOCAL_SESSION_TOKEN_KEY) || null;

    if (this.sessionToken) {
      await this.touchSession();
    } else {
      this.profile = null;
    }

    return this.snapshot();
  }

  snapshot() {
    return {
      state: deepClone(this.state),
      profile: this.profile ? { ...this.profile } : null,
      session: this.sessionToken ? { token: this.sessionToken } : null,
    };
  }

  findMemberByNormalizedName(name) {
    const normalized = normalizeName(name);
    return this.members.find((member) => member.login_name_normalized === normalized) || null;
  }

  getCurrentMemberRecord() {
    if (!this.profile?.id) {
      return null;
    }

    return this.members.find((member) => member.id === this.profile.id) || null;
  }

  assertPresident() {
    const member = this.getCurrentMemberRecord();
    if (!member || member.role !== ROLE_TYPES.president) {
      throw new Error("Only the president can use that control.");
    }
    return member;
  }

  createSessionForMember(member) {
    const token = randomId("session");
    const session = {
      id: randomId("session-row"),
      member_id: member.id,
      token,
      created_at: nowIso(),
      last_seen_at: nowIso(),
      revoked_at: null,
      revoked_reason: null,
    };

    this.sessions.push(session);
    this.sessionToken = token;
    window.localStorage.setItem(LOCAL_SESSION_TOKEN_KEY, token);
    this.profile = publicMember(member, this.sessions);
    this.persistCollections();
    return this.snapshot();
  }

  async signUp({ name, password, memberStatus }) {
    validateCredentials(name, password);

    if (this.findMemberByNormalizedName(name)) {
      throw new Error("That name is already in use. Try a slightly different version.");
    }

    const member = {
      id: randomId("member"),
      login_name: name.trim(),
      login_name_normalized: normalizeName(name),
      display_name: name.trim(),
      password,
      role: ROLE_TYPES.member,
      member_status: memberStatus || MEMBER_STATUSES.active,
      contact_email: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    this.members.push(member);
    return this.createSessionForMember(member);
  }

  async signIn(name, password) {
    validateCredentials(name, password);
    const member = this.findMemberByNormalizedName(name);

    if (!member || member.password !== password) {
      throw new Error("That name and password did not match.");
    }

    return this.createSessionForMember(member);
  }

  async signInPresident(password) {
    validateCredentials("President", password);
    let member =
      this.members.find((entry) => entry.contact_email === PRESIDENT_EMAIL) || null;

    if (!member) {
      member = {
        id: randomId("member"),
        login_name: "President",
        login_name_normalized: normalizeName("President"),
        display_name: "President",
        password,
        role: ROLE_TYPES.president,
        member_status: MEMBER_STATUSES.active,
        contact_email: PRESIDENT_EMAIL,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      this.members.push(member);
    } else if (member.password !== password) {
      throw new Error("The president password is incorrect.");
    }

    return this.createSessionForMember(member);
  }

  async touchSession() {
    if (!this.sessionToken) {
      this.profile = null;
      return null;
    }

    const session = this.sessions.find(
      (entry) => entry.token === this.sessionToken && !entry.revoked_at,
    );

    if (!session) {
      this.clearSessionToken();
      return null;
    }

    session.last_seen_at = nowIso();
    const member = this.members.find((entry) => entry.id === session.member_id) || null;

    if (!member) {
      this.clearSessionToken();
      this.persistCollections();
      return null;
    }

    this.profile = publicMember(member, this.sessions);
    this.persistCollections();
    return {
      session_token: this.sessionToken,
      member: { ...this.profile },
    };
  }

  async signOut() {
    if (this.sessionToken) {
      const session = this.sessions.find((entry) => entry.token === this.sessionToken);
      if (session) {
        session.revoked_at = nowIso();
        session.revoked_reason = "signed out";
      }
    }

    this.persistCollections();
    this.clearSessionToken();
    return this.snapshot();
  }

  async resetDemoData() {
    this.state = createInitialState();
    this.members = [];
    this.votes = {};
    this.sessions = [];
    this.clearSessionToken();
    window.localStorage.removeItem(LOCAL_STATE_KEY);
    window.localStorage.removeItem(LOCAL_MEMBERS_KEY);
    window.localStorage.removeItem(LOCAL_VOTES_KEY);
    window.localStorage.removeItem(LOCAL_SESSIONS_KEY);
    return this.snapshot();
  }

  async saveProfile({ displayName, memberStatus, newPassword }) {
    const member = this.getCurrentMemberRecord();
    if (!member) {
      throw new Error("Sign in before saving your profile.");
    }

    if (!displayName.trim()) {
      throw new Error("Enter your name before saving.");
    }

    const nextNormalized = normalizeName(displayName);
    const duplicate = this.members.find(
      (entry) =>
        entry.id !== member.id && entry.login_name_normalized === nextNormalized,
    );

    if (duplicate) {
      throw new Error("That name is already taken by another member.");
    }

    member.display_name = displayName.trim();
    member.login_name = displayName.trim();
    member.login_name_normalized = nextNormalized;
    member.member_status = memberStatus || MEMBER_STATUSES.active;
    member.updated_at = nowIso();

    if (newPassword?.trim()) {
      if (newPassword.trim().length < 6) {
        throw new Error("Use a password with at least 6 characters.");
      }
      member.password = newPassword.trim();
    }

    this.profile = publicMember(member, this.sessions);
    this.persistCollections();
    return { ...this.profile };
  }

  async getState() {
    this.state = normalizeState(readJson(LOCAL_STATE_KEY, this.state));
    return deepClone(this.state);
  }

  async saveState(nextState) {
    this.assertPresident();
    this.state = normalizeState({
      ...nextState,
      timestamps: {
        ...(nextState.timestamps || {}),
        updatedAt: nowIso(),
      },
    });
    writeJson(LOCAL_STATE_KEY, this.state);
    return deepClone(this.state);
  }

  async getUserVote(officeId) {
    if (!this.profile) {
      return null;
    }

    return (
      Object.values(this.votes).find(
        (vote) => vote.office_id === officeId && vote.voter_id === this.profile.id,
      ) || null
    );
  }

  async getVotesForOffice(officeId) {
    this.assertPresident();
    return Object.values(this.votes).filter((vote) => vote.office_id === officeId);
  }

  async submitVote(officeId, ballotPayload) {
    if (!this.profile) {
      throw new Error("Sign in before voting.");
    }

    const key = `${officeId}::${this.profile.id}`;
    this.votes[key] = {
      office_id: officeId,
      voter_id: this.profile.id,
      updated_at: nowIso(),
      ballot_payload: ballotPayload,
    };
    writeJson(LOCAL_VOTES_KEY, this.votes);
    return { ...this.votes[key] };
  }

  async listMembers() {
    this.assertPresident();
    return sortMembers(this.members.map((member) => publicMember(member, this.sessions)));
  }

  async setMemberRole(memberId, role) {
    this.assertPresident();
    const member = this.members.find((entry) => entry.id === memberId);

    if (!member) {
      throw new Error("Member not found.");
    }

    if (member.contact_email === PRESIDENT_EMAIL && role !== ROLE_TYPES.president) {
      throw new Error("The main president account cannot lose president access.");
    }

    member.role = role;
    member.updated_at = nowIso();

    if (this.profile?.id === member.id) {
      this.profile = publicMember(member, this.sessions);
    }

    this.persistCollections();
    return publicMember(member, this.sessions);
  }

  async kickMember(memberId) {
    this.assertPresident();
    this.sessions = this.sessions.map((session) =>
      session.member_id === memberId && !session.revoked_at
        ? {
            ...session,
            revoked_at: nowIso(),
            revoked_reason: "kicked by president",
          }
        : session,
    );

    if (this.profile?.id === memberId) {
      this.clearSessionToken();
    }

    writeJson(LOCAL_SESSIONS_KEY, this.sessions);
    return true;
  }
}

export class SupabaseElectionService {
  constructor(config) {
    this.mode = "supabase";
    this.label = "Supabase sync";
    this.requiresAuth = false;
    this.client = createClient(config.supabaseUrl, config.supabaseAnonKey);
    this.state = createInitialState();
    this.profile = null;
    this.sessionToken = window.localStorage.getItem(LOCAL_SESSION_TOKEN_KEY) || null;
  }

  snapshot() {
    return {
      state: deepClone(this.state),
      profile: this.profile ? { ...this.profile } : null,
      session: this.sessionToken ? { token: this.sessionToken } : null,
    };
  }

  async callRpc(functionName, params = {}) {
    const { data, error } = await this.client.rpc(functionName, params);

    if (error) {
      throw new Error(error.message || "Supabase request failed.");
    }

    return data;
  }

  clearSession() {
    this.sessionToken = null;
    this.profile = null;
    window.localStorage.removeItem(LOCAL_SESSION_TOKEN_KEY);
  }

  setAuthPayload(payload) {
    if (!payload?.session_token || !payload?.member) {
      throw new Error("The server did not return a valid session.");
    }

    this.sessionToken = payload.session_token;
    this.profile = payload.member;
    window.localStorage.setItem(LOCAL_SESSION_TOKEN_KEY, this.sessionToken);
    return this.snapshot();
  }

  async loadState() {
    const data = await this.callRpc("get_public_state");
    this.state = normalizeState(data || createInitialState());
    return deepClone(this.state);
  }

  async init() {
    await this.loadState();

    if (this.sessionToken) {
      try {
        const data = await this.callRpc("touch_session", {
          p_session_token: this.sessionToken,
        });

        if (data?.member) {
          this.profile = data.member;
        } else {
          this.clearSession();
        }
      } catch (error) {
        this.clearSession();
      }
    } else {
      this.profile = null;
    }

    return this.snapshot();
  }

  async signUp({ name, password, memberStatus }) {
    const data = await this.callRpc("register_member", {
      p_name: name,
      p_password: password,
      p_member_status: memberStatus || MEMBER_STATUSES.active,
    });

    return this.setAuthPayload(data);
  }

  async signIn(name, password) {
    const data = await this.callRpc("sign_in_member", {
      p_name: name,
      p_password: password,
    });

    return this.setAuthPayload(data);
  }

  async signInPresident(password) {
    const data = await this.callRpc("sign_in_president", {
      p_password: password,
    });

    return this.setAuthPayload(data);
  }

  async signOut() {
    if (this.sessionToken) {
      await this.callRpc("sign_out_member", {
        p_session_token: this.sessionToken,
      });
    }

    this.clearSession();
    return this.snapshot();
  }

  async saveProfile({ displayName, memberStatus, newPassword }) {
    if (!this.sessionToken) {
      throw new Error("Sign in before saving your profile.");
    }

    const data = await this.callRpc("update_member_profile", {
      p_session_token: this.sessionToken,
      p_display_name: displayName,
      p_member_status: memberStatus || MEMBER_STATUSES.active,
      p_new_password: newPassword?.trim() || null,
    });

    this.profile = data;
    return { ...this.profile };
  }

  async getState() {
    return this.loadState();
  }

  async saveState(nextState) {
    if (!this.sessionToken) {
      throw new Error("Sign in as the president before changing election state.");
    }

    const data = await this.callRpc("save_app_state", {
      p_session_token: this.sessionToken,
      p_state: normalizeState(nextState),
    });

    this.state = normalizeState(data);
    return deepClone(this.state);
  }

  async getUserVote(officeId) {
    if (!this.sessionToken) {
      return null;
    }

    return await this.callRpc("get_member_vote", {
      p_session_token: this.sessionToken,
      p_office_id: officeId,
    });
  }

  async getVotesForOffice(officeId) {
    if (!this.sessionToken) {
      return [];
    }

    return (
      (await this.callRpc("get_office_votes", {
        p_session_token: this.sessionToken,
        p_office_id: officeId,
      })) || []
    );
  }

  async submitVote(officeId, ballotPayload) {
    if (!this.sessionToken) {
      throw new Error("Sign in before voting.");
    }

    return await this.callRpc("submit_vote", {
      p_session_token: this.sessionToken,
      p_office_id: officeId,
      p_ballot_payload: ballotPayload,
    });
  }

  async listMembers() {
    if (!this.sessionToken) {
      return [];
    }

    return (
      (await this.callRpc("list_members", {
        p_session_token: this.sessionToken,
      })) || []
    );
  }

  async setMemberRole(memberId, role) {
    if (!this.sessionToken) {
      throw new Error("Sign in as the president first.");
    }

    return await this.callRpc("set_member_role", {
      p_session_token: this.sessionToken,
      p_member_id: memberId,
      p_role: role,
    });
  }

  async kickMember(memberId) {
    if (!this.sessionToken) {
      throw new Error("Sign in as the president first.");
    }

    await this.callRpc("kick_member", {
      p_session_token: this.sessionToken,
      p_member_id: memberId,
    });
    return true;
  }
}

export function buildElectionService(config) {
  if (config?.supabaseUrl && config?.supabaseAnonKey) {
    return new SupabaseElectionService(config);
  }

  return new LocalElectionService();
}
