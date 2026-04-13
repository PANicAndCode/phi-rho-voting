export const APP_VERSION = 1;

export const PHASES = {
  idle: {
    label: "Awaiting cue",
    durationSeconds: 0,
    shortLabel: "Idle",
    description: "The president can cue the next office whenever the room is ready.",
  },
  speech: {
    label: "Speech in progress",
    durationSeconds: 3 * 60,
    shortLabel: "Speech",
    description: "Each candidate has three minutes for opening remarks.",
  },
  qa: {
    label: "Question and answer",
    durationSeconds: 7 * 60,
    shortLabel: "Q&A",
    description: "Each candidate has seven minutes for chapter questions.",
  },
  discussion: {
    label: "Chapter discussion",
    durationSeconds: 10 * 60,
    shortLabel: "Discussion",
    description:
      "After candidate presentations, the chapter may discuss for up to ten minutes.",
  },
  voting: {
    label: "Voting open",
    durationSeconds: 0,
    shortLabel: "Voting",
    description: "Secret ballots are open for the active office.",
  },
  closed: {
    label: "Voting closed",
    durationSeconds: 0,
    shortLabel: "Closed",
    description: "Ballots are closed until the president opens the next office.",
  },
};

export const BALLOT_TYPES = {
  single: "single",
  ranked: "ranked",
};

export const ROLE_TYPES = {
  member: "member",
  president: "president",
};

export const MEMBER_STATUSES = {
  active: "active",
  inactive: "inactive",
};

function makeOffice({
  id,
  name,
  category,
  isExec = false,
  ballotType = BALLOT_TYPES.single,
  seats = 1,
  termLabel,
  eligibilityNote,
  ruleSummary,
  note = "",
  candidates = [],
  sortOrder,
}) {
  return {
    id,
    slug: id,
    name,
    category,
    isExec,
    ballotType,
    seats,
    termLabel,
    eligibilityNote,
    ruleSummary,
    note,
    sortOrder,
    candidates,
  };
}

export const DEFAULT_OFFICES = [
  makeOffice({
    id: "president",
    name: "President",
    category: "exec",
    isExec: true,
    termLabel: "Calendar year",
    eligibilityNote: "May serve one consecutive term.",
    ruleSummary:
      "Simple majority. If unopposed, the candidate must receive a three-fourths affirmative vote.",
    note:
      "If the Presidential office becomes vacant, VP-I acts as interim President until a special election is held.",
    sortOrder: 0,
  }),
  makeOffice({
    id: "vice-president-internal",
    name: "Vice President Internal",
    category: "exec",
    isExec: true,
    termLabel: "Academic year",
    eligibilityNote: "May serve one consecutive term.",
    ruleSummary:
      "Simple majority. If unopposed and treated as exec, requires a three-fourths affirmative vote.",
    sortOrder: 1,
  }),
  makeOffice({
    id: "vice-president-finance",
    name: "Vice President of Finance",
    category: "exec",
    isExec: true,
    termLabel: "Calendar year",
    eligibilityNote: "May serve one consecutive term.",
    ruleSummary:
      "Simple majority. If unopposed and treated as exec, requires a three-fourths affirmative vote.",
    sortOrder: 2,
  }),
  makeOffice({
    id: "vice-president-membership-education",
    name: "Vice President of Membership Education",
    category: "exec",
    isExec: true,
    termLabel: "One semester",
    eligibilityNote: "May serve up to two consecutive terms.",
    ruleSummary:
      "Simple majority. If unopposed and treated as exec, requires a three-fourths affirmative vote.",
    sortOrder: 3,
  }),
  makeOffice({
    id: "vice-president-recruitment",
    name: "Vice President of Recruitment",
    category: "exec",
    isExec: true,
    termLabel: "One semester",
    eligibilityNote: "May serve up to two consecutive terms.",
    ruleSummary:
      "Simple majority. If unopposed and treated as exec, requires a three-fourths affirmative vote.",
    sortOrder: 4,
  }),
  makeOffice({
    id: "social-chair",
    name: "Social Chair",
    category: "exec",
    isExec: true,
    termLabel: "Academic year",
    eligibilityNote: "May serve one consecutive term.",
    ruleSummary:
      "Simple majority. If unopposed and treated as exec, requires a three-fourths affirmative vote.",
    sortOrder: 5,
  }),
  makeOffice({
    id: "secretary",
    name: "Secretary",
    category: "exec",
    isExec: true,
    termLabel: "Academic year",
    eligibilityNote: "May serve one consecutive term.",
    ruleSummary:
      "Simple majority. If unopposed and treated as exec, requires a three-fourths affirmative vote.",
    sortOrder: 6,
  }),
  makeOffice({
    id: "scholarship-chair",
    name: "Scholarship Chair",
    category: "chair",
    termLabel: "Chapter-defined term",
    eligibilityNote: "May serve one consecutive term unless chapter rules say otherwise.",
    ruleSummary: "Simple majority vote.",
    sortOrder: 7,
  }),
  makeOffice({
    id: "campus-relations",
    name: "Campus Relations",
    category: "chair",
    termLabel: "Chapter-defined term",
    eligibilityNote: "May serve one consecutive term unless chapter rules say otherwise.",
    ruleSummary: "Simple majority vote.",
    sortOrder: 8,
  }),
  makeOffice({
    id: "sisterhood-chair",
    name: "Sisterhood Chair",
    category: "chair",
    termLabel: "Chapter-defined term",
    eligibilityNote: "May serve one consecutive term unless chapter rules say otherwise.",
    ruleSummary: "Simple majority vote.",
    sortOrder: 9,
  }),
  makeOffice({
    id: "historian",
    name: "Historian",
    category: "chair",
    termLabel: "Chapter-defined term",
    eligibilityNote: "May serve one consecutive term unless chapter rules say otherwise.",
    ruleSummary: "Simple majority vote.",
    sortOrder: 10,
  }),
  makeOffice({
    id: "alumni-correspondent",
    name: "Alumni Correspondent",
    category: "chair",
    termLabel: "Chapter-defined term",
    eligibilityNote: "May serve one consecutive term unless chapter rules say otherwise.",
    ruleSummary: "Simple majority vote.",
    sortOrder: 11,
  }),
  makeOffice({
    id: "standards-board",
    name: "Standards Board",
    category: "standards",
    ballotType: BALLOT_TYPES.ranked,
    seats: 4,
    termLabel: "Semester",
    eligibilityNote: "Four members are elected each semester.",
    ruleSummary:
      "Active members rank their top four choices. This app tallies the ranked ballot as 4, 3, 2, 1 points for first through fourth place.",
    note:
      "The VP-I discloses the outcome of the election to the sorority after the tally is complete.",
    sortOrder: 12,
  }),
];

export function createCandidate(name = "", note = "") {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `candidate-${Date.now()}`,
    name,
    note,
  };
}

export function createCustomOffice(name, ballotType, category, sortOrder) {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return makeOffice({
    id: slug || `office-${Date.now()}`,
    name: name.trim(),
    category,
    ballotType,
    seats: ballotType === BALLOT_TYPES.ranked ? 4 : 1,
    termLabel: category === "special" ? "Special election" : "Chapter-defined term",
    eligibilityNote:
      category === "special"
        ? "Use for vacancies or interim elections at Exec discretion."
        : "Eligibility depends on your local chapter rules.",
    ruleSummary:
      ballotType === BALLOT_TYPES.ranked
        ? "Rank top four choices in order of preference."
        : "Simple majority vote unless chapter rules require otherwise.",
    note:
      category === "special"
        ? "The President may appoint an interim officer while the special election is pending."
        : "",
    sortOrder,
  });
}

export function createInitialState() {
  const offices = DEFAULT_OFFICES.map((office) => ({
    ...office,
    candidates: office.candidates.map((candidate) => ({ ...candidate })),
  }));

  return {
    version: APP_VERSION,
    chapter: {
      name: "Phi Sigma Rho",
      subtitle: "Engineering sorority election center",
      motto: "Together We Build the Future",
    },
    offices,
    session: {
      activeOfficeId: offices[0]?.id ?? "",
      activeCandidateId: "",
      phase: "idle",
      phaseStartedAt: null,
      phaseEndsAt: null,
      announcement: "President may cue the next position when ready.",
    },
    timestamps: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

export function sortOffices(offices) {
  return [...offices].sort((left, right) => left.sortOrder - right.sortOrder);
}

export function normalizeState(rawState) {
  const base = createInitialState();
  const state = rawState && typeof rawState === "object" ? rawState : {};
  const offices =
    Array.isArray(state.offices) && state.offices.length ? state.offices : base.offices;
  const normalizedOffices = sortOffices(
    offices.map((office, index) => ({
      ...office,
      sortOrder: Number.isFinite(office.sortOrder) ? office.sortOrder : index,
      candidates: Array.isArray(office.candidates) ? office.candidates : [],
      seats:
        office.ballotType === BALLOT_TYPES.ranked ? office.seats || 4 : office.seats || 1,
    })),
  );
  const preferredActiveOfficeId =
    normalizedOffices.find((office) => office.id === state?.session?.activeOfficeId)?.id ||
    normalizedOffices[0]?.id ||
    "";

  return {
    ...base,
    ...state,
    offices: normalizedOffices,
    session: {
      ...base.session,
      ...(state.session || {}),
      activeOfficeId: preferredActiveOfficeId,
    },
    timestamps: {
      ...base.timestamps,
      ...(state.timestamps || {}),
      updatedAt: state?.timestamps?.updatedAt || base.timestamps.updatedAt,
    },
  };
}
