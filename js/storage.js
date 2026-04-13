import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.103.0/+esm";
import {
  createInitialState,
  MEMBER_STATUSES,
  normalizeState,
  ROLE_TYPES,
} from "./constants.js";

const LOCAL_STATE_KEY = "phi-rho-election-state-v1";
const LOCAL_PROFILE_KEY = "phi-rho-election-profile-v1";
const LOCAL_VOTES_KEY = "phi-rho-election-votes-v1";

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

export class LocalElectionService {
  constructor() {
    this.mode = "local";
    this.label = "Demo mode";
    this.requiresAuth = false;
    this.state = normalizeState(readJson(LOCAL_STATE_KEY, createInitialState()));
    this.profile = readJson(LOCAL_PROFILE_KEY, null);
    this.votes = readJson(LOCAL_VOTES_KEY, {});
  }

  async init() {
    this.state = normalizeState(readJson(LOCAL_STATE_KEY, this.state));
    this.profile = readJson(LOCAL_PROFILE_KEY, this.profile);
    this.votes = readJson(LOCAL_VOTES_KEY, this.votes);
    return this.snapshot();
  }

  snapshot() {
    return {
      state: deepClone(this.state),
      profile: this.profile ? { ...this.profile } : null,
      session: this.profile ? { user: { id: this.profile.id } } : null,
    };
  }

  async signInLocal({ displayName, role, memberStatus }) {
    this.profile = {
      id: globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}`,
      email: "demo@local",
      display_name: displayName.trim(),
      role,
      member_status: memberStatus,
    };
    writeJson(LOCAL_PROFILE_KEY, this.profile);
    return this.snapshot();
  }

  async signOut() {
    this.profile = null;
    window.localStorage.removeItem(LOCAL_PROFILE_KEY);
    return this.snapshot();
  }

  async resetDemoData() {
    this.state = createInitialState();
    this.votes = {};
    this.profile = null;
    window.localStorage.removeItem(LOCAL_STATE_KEY);
    window.localStorage.removeItem(LOCAL_PROFILE_KEY);
    window.localStorage.removeItem(LOCAL_VOTES_KEY);
    return this.snapshot();
  }

  async saveProfile({ displayName, memberStatus, role }) {
    if (!this.profile) {
      throw new Error("Enter demo mode before saving a profile.");
    }
    if (!displayName.trim()) {
      throw new Error("Enter a display name before saving your profile.");
    }

    this.profile = {
      ...this.profile,
      display_name: displayName.trim(),
      member_status: memberStatus || MEMBER_STATUSES.active,
      role: role || this.profile.role || ROLE_TYPES.member,
    };
    writeJson(LOCAL_PROFILE_KEY, this.profile);
    return { ...this.profile };
  }

  async getState() {
    this.state = normalizeState(readJson(LOCAL_STATE_KEY, this.state));
    return deepClone(this.state);
  }

  async saveState(nextState) {
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
    return Object.values(this.votes).filter((vote) => vote.office_id === officeId);
  }

  async submitVote(officeId, ballotPayload) {
    if (!this.profile) {
      throw new Error("Enter demo mode before voting.");
    }

    const key = `${officeId}::${this.profile.id}`;
    this.votes[key] = {
      office_id: officeId,
      voter_id: this.profile.id,
      voter_name: this.profile.display_name,
      updated_at: nowIso(),
      ballot_payload: ballotPayload,
    };
    writeJson(LOCAL_VOTES_KEY, this.votes);
    return { ...this.votes[key] };
  }
}

export class SupabaseElectionService {
  constructor(config) {
    this.mode = "supabase";
    this.label = "Supabase sync";
    this.requiresAuth = true;
    this.client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
    this.profile = null;
    this.session = null;
    this.state = createInitialState();
  }

  async init() {
    await this.refreshSession();
    await this.loadProfile();
    await this.loadState();
    return this.snapshot();
  }

  snapshot() {
    return {
      state: deepClone(this.state),
      profile: this.profile ? { ...this.profile } : null,
      session: this.session,
    };
  }

  async refreshSession() {
    const {
      data: { session },
      error,
    } = await this.client.auth.getSession();

    if (error) {
      throw error;
    }

    this.session = session;
    return session;
  }

  async signIn(email, password) {
    const { error } = await this.client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw error;
    }

    await this.refreshSession();
    await this.loadProfile();
    return this.snapshot();
  }

  async signUp({ email, password, displayName, memberStatus }) {
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
    });

    if (error) {
      throw error;
    }

    this.session = data.session;

    if (data.session) {
      await this.saveProfile({
        displayName,
        memberStatus,
      });
    }

    return {
      ...this.snapshot(),
      needsConfirmation: !data.session,
    };
  }

  async signOut() {
    const { error } = await this.client.auth.signOut();

    if (error) {
      throw error;
    }

    this.session = null;
    this.profile = null;
    return this.snapshot();
  }

  async loadProfile() {
    if (!this.session?.user?.id) {
      this.profile = null;
      return null;
    }

    const { data, error } = await this.client
      .from("profiles")
      .select("*")
      .eq("id", this.session.user.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    this.profile = data || null;
    return this.profile;
  }

  async saveProfile({ displayName, memberStatus }) {
    if (!this.session?.user?.id) {
      throw new Error("Sign in before saving a profile.");
    }
    if (!displayName.trim()) {
      throw new Error("Enter a display name before saving your profile.");
    }

    const payload = {
      id: this.session.user.id,
      email: this.session.user.email,
      display_name: displayName.trim(),
      member_status: memberStatus || MEMBER_STATUSES.active,
      role: this.profile?.role || ROLE_TYPES.member,
      updated_at: nowIso(),
    };

    const { data, error } = await this.client
      .from("profiles")
      .upsert(payload, {
        onConflict: "id",
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    this.profile = data;
    return { ...this.profile };
  }

  async loadState() {
    const { data, error } = await this.client
      .from("app_state")
      .select("state")
      .eq("id", true)
      .maybeSingle();

    if (error) {
      throw error;
    }

    this.state = normalizeState(data?.state || createInitialState());
    return deepClone(this.state);
  }

  async getState() {
    return this.loadState();
  }

  async saveState(nextState) {
    if (!this.session?.user?.id) {
      throw new Error("Sign in as the president before changing election state.");
    }

    const payload = {
      id: true,
      state: normalizeState({
        ...nextState,
        timestamps: {
          ...(nextState.timestamps || {}),
          updatedAt: nowIso(),
        },
      }),
      updated_at: nowIso(),
      updated_by: this.session.user.id,
    };

    const { data, error } = await this.client
      .from("app_state")
      .upsert(payload, {
        onConflict: "id",
      })
      .select("state")
      .single();

    if (error) {
      throw error;
    }

    this.state = normalizeState(data.state);
    return deepClone(this.state);
  }

  async getUserVote(officeId) {
    if (!this.session?.user?.id) {
      return null;
    }

    const { data, error } = await this.client
      .from("votes")
      .select("*")
      .eq("office_id", officeId)
      .eq("voter_id", this.session.user.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data || null;
  }

  async getVotesForOffice(officeId) {
    const { data, error } = await this.client
      .from("votes")
      .select("*")
      .eq("office_id", officeId)
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    return data || [];
  }

  async submitVote(officeId, ballotPayload) {
    if (!this.session?.user?.id) {
      throw new Error("Sign in before voting.");
    }

    const payload = {
      office_id: officeId,
      voter_id: this.session.user.id,
      ballot_payload: ballotPayload,
      updated_at: nowIso(),
    };

    const { data, error } = await this.client
      .from("votes")
      .upsert(payload, {
        onConflict: "office_id,voter_id",
      })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data;
  }
}

export function buildElectionService(config) {
  if (config?.supabaseUrl && config?.supabaseAnonKey) {
    return new SupabaseElectionService(config);
  }

  return new LocalElectionService();
}
