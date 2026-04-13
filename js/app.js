import {
  BALLOT_TYPES,
  createCandidate,
  createCustomOffice,
  createInitialState,
  MEMBER_STATUSES,
  normalizeState,
  PHASES,
  ROLE_TYPES,
} from "./constants.js";
import { buildElectionService } from "./storage.js";

const PRESIDENT_EMAIL = "president.psr.rho@gmail.com";

const app = {
  config: window.PHI_RHO_CONFIG || {},
  service: null,
  state: createInitialState(),
  profile: null,
  session: null,
  view: "member",
  reviewOfficeId: "",
  editOfficeId: "",
  currentVote: null,
  reviewVotes: [],
  memberDirectory: [],
  adminDraft: null,
  ballotDraft: null,
  syncHandle: null,
  tickerHandle: null,
  messages: {
    auth: null,
    ballot: null,
    admin: null,
  },
};

const dom = {};

function qs(id) {
  return document.getElementById(id);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setMessage(key, text, tone = "info") {
  app.messages[key] = text ? { text, tone } : null;
}

function clearMessage(key) {
  app.messages[key] = null;
}

function renderNotice(element, message) {
  if (!element) {
    return;
  }

  if (!message?.text) {
    element.classList.add("hidden");
    element.textContent = "";
    element.dataset.tone = "";
    return;
  }

  element.classList.remove("hidden");
  element.dataset.tone = message.tone || "info";
  element.textContent = message.text;
}

function isSignedIn() {
  return Boolean(app.profile);
}

function getRole() {
  return app.profile?.role || ROLE_TYPES.member;
}

function isPresident() {
  return getRole() === ROLE_TYPES.president;
}

function enforceViewAccess() {
  if (app.view === "president" && !isPresident()) {
    app.view = "member";
  }
}

function getOffices() {
  return Array.isArray(app.state.offices) ? app.state.offices : [];
}

function getOfficeById(officeId) {
  return getOffices().find((office) => office.id === officeId) || null;
}

function getActiveOffice() {
  return getOfficeById(app.state.session.activeOfficeId) || getOffices()[0] || null;
}

function getReviewOffice() {
  return getOfficeById(app.reviewOfficeId) || getActiveOffice();
}

function getEditOffice() {
  return getOfficeById(app.editOfficeId) || getActiveOffice();
}

function getCandidates(office) {
  return Array.isArray(office?.candidates) ? office.candidates : [];
}

function getCandidateById(office, candidateId) {
  return getCandidates(office).find((candidate) => candidate.id === candidateId) || null;
}

function isUnopposedExec(office) {
  return Boolean(office?.isExec && getCandidates(office).length === 1);
}

function normalizeSelectedOfficeIds() {
  const activeOffice = getActiveOffice();

  if (!getOfficeById(app.reviewOfficeId)) {
    app.reviewOfficeId = activeOffice?.id || "";
  }

  if (!getOfficeById(app.editOfficeId)) {
    app.editOfficeId = activeOffice?.id || "";
  }
}

function getPersistedAdminState() {
  return {
    activeOfficeId: app.state.session.activeOfficeId || getOffices()[0]?.id || "",
    activeCandidateId: app.state.session.activeCandidateId || "",
    announcement: app.state.session.announcement || "",
  };
}

function syncAdminDraftFromState(force = false) {
  const persisted = getPersistedAdminState();

  if (force || !app.adminDraft) {
    app.adminDraft = { ...persisted };
  }

  if (!getOfficeById(app.adminDraft.activeOfficeId)) {
    app.adminDraft.activeOfficeId = persisted.activeOfficeId;
  }

  const draftOffice =
    getOfficeById(app.adminDraft.activeOfficeId) || getOfficeById(persisted.activeOfficeId);

  if (!getCandidateById(draftOffice, app.adminDraft.activeCandidateId)) {
    app.adminDraft.activeCandidateId = "";
  }

  if (typeof app.adminDraft.announcement !== "string") {
    app.adminDraft.announcement = persisted.announcement;
  }

  return app.adminDraft;
}

function readBallotDraftFromDom(office) {
  if (!office) {
    return null;
  }

  if (office.ballotType === BALLOT_TYPES.ranked) {
    return {
      ranking: Array.from(dom.ballotForm.querySelectorAll("select")).map((select) => select.value),
    };
  }

  if (isUnopposedExec(office)) {
    return {
      approval: dom.ballotForm.querySelector('input[name="approval"]:checked')?.value || "",
    };
  }

  return {
    choice: dom.ballotForm.querySelector('input[name="choice"]:checked')?.value || "",
  };
}

function formatCountdown(ms) {
  if (ms <= 0) {
    return "00:00";
  }

  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(isoString) {
  if (!isoString) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoString));
}

function remainingPhaseMs() {
  if (!app.state.session.phaseEndsAt) {
    return 0;
  }

  return new Date(app.state.session.phaseEndsAt).getTime() - Date.now();
}

function getPhaseMeta() {
  const phaseKey = app.state.session.phase || "idle";
  const phase = PHASES[phaseKey] || PHASES.idle;
  const office = getActiveOffice();
  const candidate = getCandidateById(office, app.state.session.activeCandidateId);
  const remainingMs = remainingPhaseMs();

  let metaText = phase.description;

  if (phaseKey === "speech" || phaseKey === "qa") {
    metaText = candidate
      ? `${candidate.name} is currently on the floor.`
      : "Choose a candidate before starting this phase.";
  }

  if (phaseKey === "voting") {
    metaText = "Ballots can be submitted or updated until the president closes voting.";
  }

  if (phaseKey === "closed") {
    metaText = "The president can review results and queue the next office.";
  }

  if (
    app.state.session.phaseEndsAt &&
    remainingMs <= 0 &&
    ["speech", "qa", "discussion"].includes(phaseKey)
  ) {
    metaText = "Timer reached zero. The president can advance whenever ready.";
  }

  return {
    phaseKey,
    label: phase.label,
    timer: ["speech", "qa", "discussion"].includes(phaseKey)
      ? formatCountdown(remainingMs)
      : phaseKey === "voting"
        ? "OPEN"
        : phaseKey === "closed"
          ? "CLOSED"
          : "--:--",
    metaText,
  };
}

function getBallotAvailability(office) {
  if (!office) {
    return {
      open: false,
      label: "No office selected",
      message: "Choose an office from the president console first.",
    };
  }

  if (!isSignedIn()) {
    return {
      open: false,
      label: "Sign in required",
      message: "Sign in with your chapter name and password before voting.",
    };
  }

  if (!getCandidates(office).length) {
    return {
      open: false,
      label: "Slate incomplete",
      message: "The president still needs to add candidates to this office.",
    };
  }

  if (app.state.session.phase !== "voting") {
    return {
      open: false,
      label: "Voting not open",
      message: "The president will open the ballot after speeches and discussion.",
    };
  }

  return {
    open: true,
    label: "Voting open",
    message: "You can submit or update your ballot until the president closes the vote.",
  };
}

function summarizeVote(office, vote) {
  if (!vote?.ballot_payload || !office) {
    return "";
  }

  const payload = vote.ballot_payload;

  if (office.ballotType === BALLOT_TYPES.ranked) {
    const ranking = Array.isArray(payload.ranking) ? payload.ranking : [];
    const labels = ranking
      .map((candidateId) => getCandidateById(office, candidateId)?.name)
      .filter(Boolean);
    return labels.length ? `Ranking saved: ${labels.join(" > ")}` : "";
  }

  if (payload.approval) {
    return `Ballot saved: ${payload.approval}`;
  }

  if (payload.choice) {
    const candidate = getCandidateById(office, payload.choice);
    return candidate ? `Ballot saved for ${candidate.name}` : "";
  }

  return "";
}

function computeSingleChoiceResults(office, votes) {
  const candidates = getCandidates(office);
  const totals = candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    note: candidate.note,
    votes: 0,
  }));
  const totalById = new Map(totals.map((entry) => [entry.id, entry]));

  votes.forEach((vote) => {
    const choice = vote?.ballot_payload?.choice;
    if (choice && totalById.has(choice)) {
      totalById.get(choice).votes += 1;
    }
  });

  const ballotsCast = totals.reduce((sum, entry) => sum + entry.votes, 0);
  const sorted = [...totals].sort((left, right) => right.votes - left.votes);
  const leader = sorted[0];
  const hasMajority = ballotsCast > 0 && leader && leader.votes > ballotsCast / 2;

  return {
    type: "single",
    ballotsCast,
    rows: sorted.map((entry) => ({
      ...entry,
      percent: ballotsCast ? (entry.votes / ballotsCast) * 100 : 0,
    })),
    summary: hasMajority
      ? `${leader.name} currently has a simple majority.`
      : "No candidate has crossed the simple-majority threshold yet.",
  };
}

function computeApprovalResults(office, votes) {
  const approvalTotals = {
    approve: 0,
    deny: 0,
    abstain: 0,
  };

  votes.forEach((vote) => {
    const approval = vote?.ballot_payload?.approval;
    if (approval && approvalTotals[approval] !== undefined) {
      approvalTotals[approval] += 1;
    }
  });

  const counted = approvalTotals.approve + approvalTotals.deny;
  const affirmativeShare = counted ? approvalTotals.approve / counted : 0;
  const meetsThreshold = affirmativeShare >= 0.75;
  const candidate = getCandidates(office)[0];

  return {
    type: "approval",
    ballotsCast: approvalTotals.approve + approvalTotals.deny + approvalTotals.abstain,
    rows: [
      { label: "Approve", count: approvalTotals.approve },
      { label: "Deny", count: approvalTotals.deny },
      { label: "Abstain", count: approvalTotals.abstain },
    ],
    summary: candidate
      ? `${candidate.name} ${meetsThreshold ? "meets" : "does not yet meet"} the three-fourths affirmative threshold.`
      : "No candidate selected.",
    affirmativeShare,
  };
}

function computeRankedResults(office, votes) {
  const pointsById = new Map();
  const firstChoiceById = new Map();
  const candidates = getCandidates(office);

  candidates.forEach((candidate) => {
    pointsById.set(candidate.id, 0);
    firstChoiceById.set(candidate.id, 0);
  });

  votes.forEach((vote) => {
    const ranking = Array.isArray(vote?.ballot_payload?.ranking)
      ? vote.ballot_payload.ranking
      : [];
    const uniqueRanking = [...new Set(ranking)].slice(0, office.seats || 4);
    uniqueRanking.forEach((candidateId, index) => {
      if (!pointsById.has(candidateId)) {
        return;
      }

      const awarded = Math.max((office.seats || 4) - index, 1);
      pointsById.set(candidateId, pointsById.get(candidateId) + awarded);

      if (index === 0) {
        firstChoiceById.set(candidateId, firstChoiceById.get(candidateId) + 1);
      }
    });
  });

  const rows = candidates
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      note: candidate.note,
      score: pointsById.get(candidate.id) || 0,
      firstChoices: firstChoiceById.get(candidate.id) || 0,
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.firstChoices - left.firstChoices;
    });

  const winners = rows.slice(0, office.seats || 4).map((row) => row.name);
  return {
    type: "ranked",
    ballotsCast: votes.length,
    rows,
    summary: winners.length
      ? `Current top ${office.seats || 4}: ${winners.join(", ")}.`
      : "No ranked ballots submitted yet.",
  };
}

function computeResults(office, votes) {
  if (!office) {
    return {
      type: "empty",
      ballotsCast: 0,
      rows: [],
      summary: "No office selected.",
    };
  }

  if (!votes.length) {
    return {
      type: "empty",
      ballotsCast: 0,
      rows: [],
      summary: "No ballots have been submitted for this office yet.",
    };
  }

  if (office.ballotType === BALLOT_TYPES.ranked) {
    return computeRankedResults(office, votes);
  }

  if (isUnopposedExec(office)) {
    return computeApprovalResults(office, votes);
  }

  return computeSingleChoiceResults(office, votes);
}

function renderAuth() {
  const isRemote = app.service.mode === "supabase";
  const profileFormFocused = dom.profileForm.contains(document.activeElement);
  dom.backendBadge.textContent = isRemote ? "Supabase live sync" : "Local demo only";
  dom.backendHelpText.textContent = isRemote
    ? "The live version uses Supabase, but members still sign in only with a name and password. No email verification is required."
    : "This preview is running only in your browser. It is useful for design and flow testing, but it will not sync across devices.";

  if (isSignedIn()) {
    dom.authBadge.textContent = `${app.profile.display_name} - ${app.profile.role}`;
  } else {
    dom.authBadge.textContent = "Not signed in";
  }

  dom.credentialBlock.classList.toggle("hidden", isSignedIn());
  dom.presidentAccessBlock.classList.toggle("hidden", isSignedIn());
  dom.profileBlock.classList.toggle("hidden", !isSignedIn());
  dom.localToolsBlock.classList.toggle("hidden", isRemote);

  if (isSignedIn()) {
    dom.profileHeading.textContent = `Signed in as ${app.profile.display_name}`;
    dom.profileSummaryText.textContent = [
      `Status: ${app.profile.member_status}`,
      `Role: ${app.profile.role}`,
      app.profile.contact_email ? `President email: ${app.profile.contact_email}` : "",
    ]
      .filter(Boolean)
      .join(" - ");
    if (!profileFormFocused) {
      dom.profileDisplayName.value = app.profile.display_name || "";
      dom.profileMemberStatus.value = app.profile.member_status || MEMBER_STATUSES.active;
      dom.profilePassword.value = "";
    }
  }

  renderNotice(dom.authMessage, app.messages.auth);
}

function renderOfficeDetail(office) {
  if (!office) {
    dom.officeDetailCard.innerHTML = `
      <div class="empty-state">
        <h4>No office selected</h4>
        <p>The president can choose the next position from the console.</p>
      </div>
    `;
    return;
  }

  const ballotLabel =
    office.ballotType === BALLOT_TYPES.ranked
      ? `Rank top ${office.seats || 4}`
      : isUnopposedExec(office)
        ? "Approve / deny / abstain"
        : "Single choice";

  dom.officeDetailCard.innerHTML = `
    <div class="detail-grid">
      <div class="detail-chip"><strong>Office</strong><span>${escapeHtml(office.name)}</span></div>
      <div class="detail-chip"><strong>Ballot</strong><span>${escapeHtml(ballotLabel)}</span></div>
      <div class="detail-chip"><strong>Term</strong><span>${escapeHtml(office.termLabel || "Chapter-defined")}</span></div>
      <div class="detail-chip"><strong>Eligibility</strong><span>${escapeHtml(office.eligibilityNote || "See chapter rules")}</span></div>
    </div>
    <p class="detail-copy">${escapeHtml(office.ruleSummary || "")}</p>
    ${office.note ? `<p class="detail-copy muted-copy">${escapeHtml(office.note)}</p>` : ""}
  `;
}

function renderCandidateList(office) {
  const candidates = getCandidates(office);

  if (!office || !candidates.length) {
    dom.candidateList.innerHTML = `
      <div class="empty-state">
        <h4>No candidates yet</h4>
        <p>The president can add candidates from the console.</p>
      </div>
    `;
    return;
  }

  dom.candidateList.innerHTML = candidates
    .map((candidate) => {
      const isActiveSpeaker = app.state.session.activeCandidateId === candidate.id;

      return `
        <article class="candidate-card ${isActiveSpeaker ? "active-speaker" : ""}">
          <div>
            <h4>${escapeHtml(candidate.name)}</h4>
            <p>${escapeHtml(candidate.note || "Candidate added to the slate.")}</p>
          </div>
          ${isActiveSpeaker ? '<span class="status-pill">Current speaker</span>' : ""}
        </article>
      `;
    })
    .join("");
}

function renderBallotForm(office) {
  const availability = getBallotAvailability(office);
  dom.ballotStatusPill.textContent = availability.label;

  renderNotice(
    dom.ballotNotice,
    app.messages.ballot || {
      text: availability.message,
      tone: availability.open ? "success" : "info",
    },
  );

  if (!office) {
    dom.ballotForm.innerHTML = "";
    dom.voteReceipt.classList.add("hidden");
    return;
  }

  const existingPayload =
    (app.ballotDraft?.officeId === office.id ? app.ballotDraft.payload : null) ||
    app.currentVote?.ballot_payload ||
    {};
  const candidates = getCandidates(office);
  let ballotFields = "";

  if (office.ballotType === BALLOT_TYPES.ranked) {
    const rankingSlots = Math.min(office.seats || 4, candidates.length);
    const currentRanking = Array.isArray(existingPayload.ranking) ? existingPayload.ranking : [];

    ballotFields = Array.from({ length: rankingSlots })
      .map((_, index) => {
        const selected = currentRanking[index] || "";
        const options = candidates
          .map(
            (candidate) => `
              <option value="${escapeHtml(candidate.id)}" ${selected === candidate.id ? "selected" : ""}>
                ${escapeHtml(candidate.name)}
              </option>
            `,
          )
          .join("");

        return `
          <label>
            Rank ${index + 1}
            <select name="rank-${index}">
              <option value="">Choose a candidate</option>
              ${options}
            </select>
          </label>
        `;
      })
      .join("");
  } else if (isUnopposedExec(office)) {
    const selectedApproval = existingPayload.approval || "";
    ballotFields = `
      <fieldset class="choice-stack">
        <legend>${escapeHtml(candidates[0]?.name || "Candidate approval")}</legend>
        ${["approve", "deny", "abstain"]
          .map(
            (choice) => `
              <label class="choice-card">
                <input
                  type="radio"
                  name="approval"
                  value="${choice}"
                  ${selectedApproval === choice ? "checked" : ""}
                />
                <span>${choice[0].toUpperCase()}${choice.slice(1)}</span>
              </label>
            `,
          )
          .join("")}
      </fieldset>
    `;
  } else {
    const selectedChoice = existingPayload.choice || "";
    ballotFields = `
      <fieldset class="choice-stack">
        <legend>Select one candidate</legend>
        ${candidates
          .map(
            (candidate) => `
              <label class="choice-card">
                <input
                  type="radio"
                  name="choice"
                  value="${escapeHtml(candidate.id)}"
                  ${selectedChoice === candidate.id ? "checked" : ""}
                />
                <span>
                  <strong>${escapeHtml(candidate.name)}</strong>
                  <small>${escapeHtml(candidate.note || "Candidate")}</small>
                </span>
              </label>
            `,
          )
          .join("")}
      </fieldset>
    `;
  }

  dom.ballotForm.innerHTML = `
    ${ballotFields}
    <button type="submit" class="button primary" ${availability.open ? "" : "disabled"}>
      ${app.currentVote ? "Update ballot" : "Submit ballot"}
    </button>
  `;

  const receipt = summarizeVote(office, app.currentVote);
  if (receipt) {
    dom.voteReceipt.classList.remove("hidden");
    dom.voteReceipt.innerHTML = `
      <strong>Current ballot</strong>
      <span>${escapeHtml(receipt)}</span>
      <small>Last updated ${escapeHtml(formatDateTime(app.currentVote.updated_at))}</small>
    `;
  } else {
    dom.voteReceipt.classList.add("hidden");
    dom.voteReceipt.innerHTML = "";
  }
}

function renderOfficeQueue() {
  const activeOfficeId = app.state.session.activeOfficeId;

  dom.officeQueue.innerHTML = getOffices()
    .map((office) => {
      const isActive = office.id === activeOfficeId;
      const candidateCount = getCandidates(office).length;
      const chip = isActive
        ? "Active"
        : office.ballotType === BALLOT_TYPES.ranked
          ? "Ranked"
          : "Ready";

      return `
        <article class="queue-card ${isActive ? "queue-card-active" : ""}">
          <div>
            <h4>${escapeHtml(office.name)}</h4>
            <p>${candidateCount} candidate${candidateCount === 1 ? "" : "s"} - ${escapeHtml(
              office.termLabel || "Chapter-defined term",
            )}</p>
          </div>
          <span class="status-pill ${isActive ? "" : "muted"}">${escapeHtml(chip)}</span>
        </article>
      `;
    })
    .join("");
}

function renderBoard() {
  const office = getActiveOffice();
  const candidate = getCandidateById(office, app.state.session.activeCandidateId);
  const phaseMeta = getPhaseMeta();

  dom.phaseBanner.innerHTML = `
    <div>
      <strong>${escapeHtml(phaseMeta.label)}</strong>
      <span>${escapeHtml(app.state.session.announcement || phaseMeta.metaText)}</span>
    </div>
  `;

  dom.currentOfficeName.textContent = office?.name || "No office selected";
  dom.currentOfficeMeta.textContent = office
    ? `${office.termLabel || "Chapter-defined term"} - ${office.ruleSummary}`
    : "The president can select the next office.";
  dom.currentCandidateName.textContent = candidate?.name || "Waiting for president cue";
  dom.currentCandidateMeta.textContent =
    candidate?.note || "The current speaker will appear here during speeches and Q&A.";

  renderOfficeDetail(office);
  renderCandidateList(office);
  renderBallotForm(office);
  renderOfficeQueue();
  updateTimerDisplay();
}

function renderSelectOptions(selectElement, offices, selectedId) {
  selectElement.innerHTML = offices
    .map(
      (office) => `
        <option value="${escapeHtml(office.id)}" ${office.id === selectedId ? "selected" : ""}>
          ${escapeHtml(office.name)}
        </option>
      `,
    )
    .join("");
}

function renderCandidateOptions(selectElement, office, selectedId = "") {
  selectElement.innerHTML = `
    <option value="">No candidate selected</option>
    ${getCandidates(office)
      .map(
        (candidate) => `
          <option value="${escapeHtml(candidate.id)}" ${candidate.id === selectedId ? "selected" : ""}>
            ${escapeHtml(candidate.name)}
          </option>
        `,
      )
      .join("")}
  `;
}

function renderCandidateEditor() {
  const office = getEditOffice();

  if (!office) {
    dom.candidateEditor.innerHTML = `
      <div class="empty-state">
        <h4>No office selected</h4>
        <p>Choose an office to manage its slate.</p>
      </div>
    `;
    return;
  }

  const candidates = getCandidates(office);
  dom.candidateEditor.innerHTML = candidates.length
    ? candidates
        .map(
          (candidate) => `
            <article class="candidate-editor-row">
              <div>
                <strong>${escapeHtml(candidate.name)}</strong>
                <p>${escapeHtml(candidate.note || "No note added.")}</p>
              </div>
              <button
                type="button"
                class="button ghost compact remove-candidate-button"
                data-candidate-id="${escapeHtml(candidate.id)}"
                ${isPresident() ? "" : "disabled"}
              >
                Remove
              </button>
            </article>
          `,
        )
        .join("")
    : `
      <div class="empty-state">
        <h4>No candidates yet</h4>
        <p>Add the slate for ${escapeHtml(office.name)} below.</p>
      </div>
    `;
}

function renderResults() {
  if (!isPresident()) {
    dom.resultsCard.innerHTML = `
      <div class="empty-state">
        <h4>Results locked</h4>
        <p>Only the president account can review chapter-wide tallies.</p>
      </div>
    `;
    return;
  }

  const office = getReviewOffice();
  const result = computeResults(office, app.reviewVotes || []);

  if (result.type === "empty") {
    dom.resultsCard.innerHTML = `
      <div class="empty-state">
        <h4>${escapeHtml(office?.name || "No office selected")}</h4>
        <p>${escapeHtml(result.summary)}</p>
      </div>
    `;
    return;
  }

  if (result.type === "single") {
    dom.resultsCard.innerHTML = `
      <div class="results-summary">
        <strong>${escapeHtml(office.name)}</strong>
        <span>${result.ballotsCast} ballots cast</span>
        <p>${escapeHtml(result.summary)}</p>
      </div>
      ${result.rows
        .map(
          (row) => `
            <div class="result-row">
              <div>
                <strong>${escapeHtml(row.name)}</strong>
                <p>${escapeHtml(row.note || "Candidate")}</p>
              </div>
              <div class="result-metric">
                <strong>${row.votes}</strong>
                <span>${row.percent.toFixed(1)}%</span>
              </div>
            </div>
          `,
        )
        .join("")}
    `;
    return;
  }

  if (result.type === "approval") {
    dom.resultsCard.innerHTML = `
      <div class="results-summary">
        <strong>${escapeHtml(office.name)}</strong>
        <span>${result.ballotsCast} ballots cast</span>
        <p>${escapeHtml(result.summary)}</p>
        <p>Affirmative share: ${(result.affirmativeShare * 100).toFixed(1)}%</p>
      </div>
      ${result.rows
        .map(
          (row) => `
            <div class="result-row">
              <div><strong>${escapeHtml(row.label)}</strong></div>
              <div class="result-metric"><strong>${row.count}</strong></div>
            </div>
          `,
        )
        .join("")}
    `;
    return;
  }

  dom.resultsCard.innerHTML = `
    <div class="results-summary">
      <strong>${escapeHtml(office.name)}</strong>
      <span>${result.ballotsCast} ranked ballots</span>
      <p>${escapeHtml(result.summary)}</p>
    </div>
    ${result.rows
      .map(
        (row, index) => `
          <div class="result-row ${index < (office.seats || 4) ? "winner-row" : ""}">
            <div>
              <strong>${escapeHtml(row.name)}</strong>
              <p>${row.firstChoices} first-choice vote${row.firstChoices === 1 ? "" : "s"}</p>
            </div>
            <div class="result-metric">
              <strong>${row.score}</strong>
              <span>points</span>
            </div>
          </div>
        `,
      )
      .join("")}
  `;
}

function renderMemberManagement() {
  if (!isPresident()) {
    dom.onlineMembersCard.innerHTML = `
      <div class="empty-state">
        <h4>Member list locked</h4>
        <p>Only the president account can view who is online and manage access.</p>
      </div>
    `;
    dom.memberDirectoryCard.innerHTML = "";
    return;
  }

  const onlineMembers = app.memberDirectory.filter((member) => member.is_online);
  dom.onlineMembersCard.innerHTML = `
    <div class="results-summary">
      <strong>Online right now</strong>
      <span>${onlineMembers.length} member${onlineMembers.length === 1 ? "" : "s"} active</span>
      <p>
        ${onlineMembers.length
          ? onlineMembers.map((member) => member.display_name).join(", ")
          : "No active member sessions in the last two minutes."}
      </p>
    </div>
  `;

  dom.memberDirectoryCard.innerHTML = app.memberDirectory.length
    ? app.memberDirectory
        .map((member) => {
          const isSelf = member.id === app.profile?.id;
          const isPrimaryPresident = member.contact_email === PRESIDENT_EMAIL;
          const roleActionLabel = member.role === ROLE_TYPES.president ? "Remove access" : "Give access";
          const roleAction = member.role === ROLE_TYPES.president ? ROLE_TYPES.member : ROLE_TYPES.president;

          return `
            <article class="member-row ${member.is_online ? "queue-card-active" : ""}">
              <div class="member-main">
                <strong>${escapeHtml(member.display_name)}</strong>
                <p>
                  ${escapeHtml(member.member_status)} - ${escapeHtml(member.role)} - ${member.is_online ? "online" : "offline"}
                  ${isPrimaryPresident ? " - main president account" : ""}
                </p>
              </div>
              <div class="member-actions">
                <button
                  type="button"
                  class="button secondary compact member-role-button"
                  data-member-id="${escapeHtml(member.id)}"
                  data-role="${escapeHtml(roleAction)}"
                  ${isPrimaryPresident ? "disabled" : ""}
                >
                  ${escapeHtml(roleActionLabel)}
                </button>
                <button
                  type="button"
                  class="button ghost compact member-kick-button"
                  data-member-id="${escapeHtml(member.id)}"
                  ${isSelf ? "disabled" : ""}
                >
                  Remove member
                </button>
              </div>
            </article>
          `;
        })
        .join("")
    : `
      <div class="empty-state">
        <h4>No members yet</h4>
        <p>Members will appear here after they create accounts or sign in.</p>
      </div>
    `;
}

function renderPresidentPanel() {
  const shouldShow = app.view === "president" && isPresident();
  dom.presidentPanel.classList.toggle("hidden", !shouldShow);

  if (!shouldShow) {
    app.adminDraft = null;
    return;
  }

  const adminState = syncAdminDraftFromState();
  dom.presidentRoleBadge.textContent = "President access";
  renderNotice(dom.presidentLockNotice, app.messages.admin);

  const offices = getOffices();
  renderSelectOptions(dom.activeOfficeSelect, offices, adminState.activeOfficeId);
  renderSelectOptions(dom.editOfficeSelect, offices, app.editOfficeId);
  renderSelectOptions(dom.resultsOfficeSelect, offices, app.reviewOfficeId);

  const activeOffice = getOfficeById(adminState.activeOfficeId) || getActiveOffice();
  renderCandidateOptions(dom.activeCandidateSelect, activeOffice, adminState.activeCandidateId);

  if (document.activeElement !== dom.announcementInput) {
    dom.announcementInput.value = adminState.announcement || "";
  }

  const disableControls = !isPresident();
  [
    dom.activeOfficeSelect,
    dom.activeCandidateSelect,
    dom.announcementInput,
    dom.saveBoardButton,
    dom.speechButton,
    dom.qaButton,
    dom.discussionButton,
    dom.openVoteButton,
    dom.closeVoteButton,
    dom.extendButton,
    dom.resetPhaseButton,
    dom.editOfficeSelect,
    dom.candidateNameInput,
    dom.candidateNoteInput,
    dom.customOfficeNameInput,
    dom.customOfficeBallotType,
    dom.customOfficeCategory,
    dom.resultsOfficeSelect,
  ].forEach((element) => {
    element.disabled = disableControls;
  });

  dom.candidateForm.querySelector("button").disabled = disableControls;
  dom.customOfficeForm.querySelector("button").disabled = disableControls;

  renderMemberManagement();
  renderCandidateEditor();
  renderResults();
}

function updateTimerDisplay() {
  const office = getActiveOffice();
  const phase = getPhaseMeta();

  dom.timerLabel.textContent = phase.label;
  dom.timerValue.textContent = phase.timer;
  dom.timerMeta.textContent = phase.metaText;

  if (!office) {
    dom.timerValue.textContent = "--:--";
    dom.timerMeta.textContent = "No office has been cued yet.";
  }
}

function renderViewButtons() {
  const presidentViewActive = app.view === "president" && isPresident();
  dom.memberViewButton.classList.toggle("primary", app.view === "member");
  dom.memberViewButton.classList.toggle("secondary", app.view !== "member");
  dom.presidentViewButton.classList.toggle("hidden", !isPresident());
  dom.presidentViewButton.classList.toggle("primary", presidentViewActive);
  dom.presidentViewButton.classList.toggle("ghost", !presidentViewActive);
}

function render() {
  enforceViewAccess();
  normalizeSelectedOfficeIds();
  renderAuth();
  renderViewButtons();
  renderBoard();
  renderPresidentPanel();
}

async function refreshCurrentVote() {
  const office = getActiveOffice();
  app.currentVote = office && isSignedIn() ? await app.service.getUserVote(office.id) : null;
}

async function refreshReviewVotes() {
  if (!isPresident()) {
    app.reviewVotes = [];
    return;
  }

  const office = getReviewOffice();
  app.reviewVotes = office ? await app.service.getVotesForOffice(office.id) : [];
}

async function refreshMemberDirectory() {
  if (!isPresident()) {
    app.memberDirectory = [];
    return;
  }

  app.memberDirectory = await app.service.listMembers();
}

async function refreshFromService() {
  const snapshot = await app.service.init();
  app.state = normalizeState(snapshot.state);
  app.profile = snapshot.profile;
  app.session = snapshot.session;

  if (!isPresident()) {
    app.adminDraft = null;
  }

  if (!isSignedIn()) {
    app.ballotDraft = null;
  }

  normalizeSelectedOfficeIds();
  await refreshCurrentVote();
  await refreshReviewVotes();
  await refreshMemberDirectory();
  render();
}

async function runWithErrorHandling(task, messageKey = "auth") {
  try {
    await task();
  } catch (error) {
    console.error(error);
    setMessage(messageKey, error.message || "Something went wrong.", "error");
    render();
  }
}

async function persistState(mutator) {
  if (!isPresident()) {
    throw new Error("Only the president can change election flow and office setup.");
  }

  const nextState = deepClone(app.state);
  mutator(nextState);
  nextState.timestamps.updatedAt = new Date().toISOString();
  await app.service.saveState(nextState);
  await refreshFromService();
}

async function handleMemberSignIn() {
  const name = dom.memberNameInput.value.trim();
  const password = dom.memberPasswordInput.value.trim();
  await app.service.signIn(name, password);
  app.adminDraft = null;
  app.ballotDraft = null;
  setMessage("auth", "Signed in successfully.", "success");
  clearMessage("ballot");
  await refreshFromService();
}

async function handleMemberSignUp() {
  const name = dom.memberNameInput.value.trim();
  const password = dom.memberPasswordInput.value.trim();
  const memberStatus = dom.memberStatusInput.value;
  await app.service.signUp({ name, password, memberStatus });
  app.adminDraft = null;
  app.ballotDraft = null;
  setMessage("auth", "Account created and signed in.", "success");
  clearMessage("ballot");
  await refreshFromService();
}

async function handlePresidentSignIn() {
  const password = dom.presidentPasswordInput.value.trim();
  await app.service.signInPresident(password);
  app.adminDraft = null;
  app.ballotDraft = null;
  app.view = "president";
  setMessage("auth", "President console unlocked.", "success");
  await refreshFromService();
}

async function handleBallotSubmit(event) {
  event.preventDefault();
  const office = getActiveOffice();
  const availability = getBallotAvailability(office);

  if (!availability.open) {
    throw new Error(availability.message);
  }

  let payload;

  if (office.ballotType === BALLOT_TYPES.ranked) {
    const ranking = Array.from(dom.ballotForm.querySelectorAll("select"))
      .map((select) => select.value)
      .filter(Boolean);
    const unique = [...new Set(ranking)];

    if (!unique.length) {
      throw new Error("Choose at least one ranked candidate.");
    }

    if (unique.length !== ranking.length) {
      throw new Error("Each ranked slot must contain a different candidate.");
    }

    payload = { ranking: unique };
  } else if (isUnopposedExec(office)) {
    const approval = dom.ballotForm.querySelector('input[name="approval"]:checked')?.value;

    if (!approval) {
      throw new Error("Choose approve, deny, or abstain before submitting.");
    }

    payload = { approval };
  } else {
    const choice = dom.ballotForm.querySelector('input[name="choice"]:checked')?.value;

    if (!choice) {
      throw new Error("Choose one candidate before submitting.");
    }

    payload = { choice };
  }

  await app.service.submitVote(office.id, payload);
  app.ballotDraft = null;
  setMessage("ballot", "Ballot saved.", "success");
  await refreshFromService();
}

async function handleSaveBoardSetup() {
  const nextOfficeId = dom.activeOfficeSelect.value;
  const nextCandidateId = dom.activeCandidateSelect.value;
  const announcement = dom.announcementInput.value.trim();

  await persistState((nextState) => {
    nextState.session.activeOfficeId = nextOfficeId;
    nextState.session.activeCandidateId = nextCandidateId;
    nextState.session.announcement =
      announcement || "President may cue the next position when ready.";
  });

  app.adminDraft = null;
  setMessage("admin", "Board setup updated.", "success");
  render();
}

async function startPhase(phaseKey) {
  const office = getOfficeById(dom.activeOfficeSelect.value);
  const candidateId = dom.activeCandidateSelect.value;

  if (!office) {
    throw new Error("Choose an office first.");
  }

  if ((phaseKey === "speech" || phaseKey === "qa") && !candidateId) {
    throw new Error("Choose the current speaker before starting speeches or Q&A.");
  }

  await persistState((nextState) => {
    const now = Date.now();
    const duration = PHASES[phaseKey].durationSeconds * 1000;
    nextState.session.activeOfficeId = office.id;
    nextState.session.activeCandidateId = candidateId;
    nextState.session.phase = phaseKey;
    nextState.session.phaseStartedAt = new Date(now).toISOString();
    nextState.session.phaseEndsAt = duration ? new Date(now + duration).toISOString() : null;
    nextState.session.announcement = `${office.name}: ${PHASES[phaseKey].label}.`;
  });

  app.adminDraft = null;
  setMessage("admin", `${PHASES[phaseKey].label} started.`, "success");
  render();
}

async function openVoting() {
  const office = getOfficeById(dom.activeOfficeSelect.value);

  if (!office) {
    throw new Error("Choose an office before opening voting.");
  }

  if (!getCandidates(office).length) {
    throw new Error("Add at least one candidate before opening the ballot.");
  }

  await persistState((nextState) => {
    nextState.session.activeOfficeId = office.id;
    nextState.session.activeCandidateId = "";
    nextState.session.phase = "voting";
    nextState.session.phaseStartedAt = new Date().toISOString();
    nextState.session.phaseEndsAt = null;
    nextState.session.announcement = `${office.name}: voting is now open.`;
  });

  app.adminDraft = null;
  setMessage("admin", "Voting opened.", "success");
  render();
}

async function closeVoting() {
  await persistState((nextState) => {
    nextState.session.phase = "closed";
    nextState.session.phaseEndsAt = null;
    nextState.session.activeCandidateId = "";
    nextState.session.announcement =
      "Voting is closed. Results are visible only in the president console.";
  });

  app.adminDraft = null;
  setMessage("admin", "Voting closed.", "success");
  render();
}

async function extendTimer() {
  const phaseKey = app.state.session.phase;

  if (!["speech", "qa", "discussion"].includes(phaseKey) || !app.state.session.phaseEndsAt) {
    throw new Error("Only a live timed phase can be extended.");
  }

  await persistState((nextState) => {
    const nextEnd = new Date(nextState.session.phaseEndsAt).getTime() + 60_000;
    nextState.session.phaseEndsAt = new Date(nextEnd).toISOString();
    nextState.session.announcement = `${PHASES[phaseKey].label} extended by one minute.`;
  });

  app.adminDraft = null;
  setMessage("admin", "Added one minute to the timer.", "success");
  render();
}

async function resetPhase() {
  await persistState((nextState) => {
    nextState.session.phase = "idle";
    nextState.session.phaseStartedAt = null;
    nextState.session.phaseEndsAt = null;
    nextState.session.activeCandidateId = "";
    nextState.session.announcement = "President may cue the next position when ready.";
  });

  app.adminDraft = null;
  setMessage("admin", "Phase reset to idle.", "success");
  render();
}

async function addCandidate() {
  const office = getEditOffice();
  const name = dom.candidateNameInput.value.trim();
  const note = dom.candidateNoteInput.value.trim();

  if (!office) {
    throw new Error("Choose an office before adding candidates.");
  }

  if (!name) {
    throw new Error("Enter the candidate's name.");
  }

  await persistState((nextState) => {
    const targetOffice = nextState.offices.find((entry) => entry.id === office.id);
    targetOffice.candidates.push(createCandidate(name, note));
  });

  dom.candidateNameInput.value = "";
  dom.candidateNoteInput.value = "";
  setMessage("admin", `Added ${name} to ${office.name}.`, "success");
  render();
}

async function removeCandidate(candidateId) {
  const office = getEditOffice();
  const candidate = getCandidateById(office, candidateId);

  if (!office || !candidate) {
    return;
  }

  await persistState((nextState) => {
    const targetOffice = nextState.offices.find((entry) => entry.id === office.id);
    targetOffice.candidates = targetOffice.candidates.filter((entry) => entry.id !== candidateId);

    if (nextState.session.activeCandidateId === candidateId) {
      nextState.session.activeCandidateId = "";
    }
  });

  setMessage("admin", `Removed ${candidate.name} from ${office.name}.`, "success");
  render();
}

async function addCustomOffice() {
  const name = dom.customOfficeNameInput.value.trim();
  const ballotType = dom.customOfficeBallotType.value;
  const category = dom.customOfficeCategory.value;

  if (!name) {
    throw new Error("Enter a name for the new office.");
  }

  if (getOffices().some((office) => office.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("An office with that name already exists.");
  }

  await persistState((nextState) => {
    const nextOrder = nextState.offices.length;
    const office = createCustomOffice(name, ballotType, category, nextOrder);
    nextState.offices.push(office);
  });

  dom.customOfficeNameInput.value = "";
  setMessage("admin", `${name} added to the election lineup.`, "success");
  render();
}

async function handleRoleChange(memberId, role) {
  await app.service.setMemberRole(memberId, role);
  setMessage(
    "admin",
    role === ROLE_TYPES.president
      ? "President access granted."
      : "President access removed.",
    "success",
  );
  await refreshFromService();
}

async function handleKickMember(memberId) {
  await app.service.kickMember(memberId);
  setMessage("admin", "Member account removed.", "success");
  await refreshFromService();
}

function bindEvents() {
  dom.memberSignInButton.addEventListener("click", () =>
    runWithErrorHandling(handleMemberSignIn, "auth"),
  );
  dom.memberSignUpButton.addEventListener("click", () =>
    runWithErrorHandling(handleMemberSignUp, "auth"),
  );
  dom.presidentSignInButton.addEventListener("click", () =>
    runWithErrorHandling(handlePresidentSignIn, "auth"),
  );

  dom.profileForm.addEventListener("submit", (event) =>
    runWithErrorHandling(async () => {
      event.preventDefault();
      await app.service.saveProfile({
        displayName: dom.profileDisplayName.value.trim(),
        memberStatus: dom.profileMemberStatus.value,
        newPassword: dom.profilePassword.value.trim(),
      });
      setMessage("auth", "Profile updated.", "success");
      await refreshFromService();
    }, "auth"),
  );

  dom.signOutButton.addEventListener("click", () =>
    runWithErrorHandling(async () => {
      await app.service.signOut();
      app.adminDraft = null;
      app.ballotDraft = null;
      setMessage("auth", "Signed out.", "success");
      app.view = "member";
      await refreshFromService();
    }, "auth"),
  );

  dom.resetDemoButton.addEventListener("click", () =>
    runWithErrorHandling(async () => {
      await app.service.resetDemoData();
      app.adminDraft = null;
      app.ballotDraft = null;
      setMessage("auth", "Local demo data reset.", "success");
      app.view = "member";
      await refreshFromService();
    }, "auth"),
  );

  dom.memberViewButton.addEventListener("click", () => {
    app.view = "member";
    render();
  });

  dom.presidentViewButton.addEventListener("click", () => {
    if (!isPresident()) {
      app.view = "member";
      render();
      return;
    }

    app.view = "president";
    render();
  });

  dom.ballotForm.addEventListener("submit", (event) =>
    runWithErrorHandling(() => handleBallotSubmit(event), "ballot"),
  );

  dom.ballotForm.addEventListener("change", () => {
    const office = getActiveOffice();
    if (!office) {
      app.ballotDraft = null;
      return;
    }

    app.ballotDraft = {
      officeId: office.id,
      payload: readBallotDraftFromDom(office),
    };
  });

  dom.activeOfficeSelect.addEventListener("change", () => {
    const office = getOfficeById(dom.activeOfficeSelect.value);
    const adminState = syncAdminDraftFromState();
    adminState.activeOfficeId = dom.activeOfficeSelect.value;

    if (!getCandidateById(office, adminState.activeCandidateId)) {
      adminState.activeCandidateId = "";
    }

    renderCandidateOptions(dom.activeCandidateSelect, office, adminState.activeCandidateId);
  });

  dom.activeCandidateSelect.addEventListener("change", () => {
    syncAdminDraftFromState().activeCandidateId = dom.activeCandidateSelect.value;
  });

  dom.announcementInput.addEventListener("input", () => {
    syncAdminDraftFromState().announcement = dom.announcementInput.value;
  });

  dom.editOfficeSelect.addEventListener("change", () => {
    app.editOfficeId = dom.editOfficeSelect.value;
    renderPresidentPanel();
  });

  dom.resultsOfficeSelect.addEventListener("change", () =>
    runWithErrorHandling(async () => {
      app.reviewOfficeId = dom.resultsOfficeSelect.value;
      await refreshReviewVotes();
      renderPresidentPanel();
    }, "admin"),
  );

  dom.saveBoardButton.addEventListener("click", () =>
    runWithErrorHandling(handleSaveBoardSetup, "admin"),
  );
  dom.speechButton.addEventListener("click", () =>
    runWithErrorHandling(() => startPhase("speech"), "admin"),
  );
  dom.qaButton.addEventListener("click", () =>
    runWithErrorHandling(() => startPhase("qa"), "admin"),
  );
  dom.discussionButton.addEventListener("click", () =>
    runWithErrorHandling(() => startPhase("discussion"), "admin"),
  );
  dom.openVoteButton.addEventListener("click", () =>
    runWithErrorHandling(openVoting, "admin"),
  );
  dom.closeVoteButton.addEventListener("click", () =>
    runWithErrorHandling(closeVoting, "admin"),
  );
  dom.extendButton.addEventListener("click", () =>
    runWithErrorHandling(extendTimer, "admin"),
  );
  dom.resetPhaseButton.addEventListener("click", () =>
    runWithErrorHandling(resetPhase, "admin"),
  );

  dom.candidateForm.addEventListener("submit", (event) =>
    runWithErrorHandling(async () => {
      event.preventDefault();
      await addCandidate();
    }, "admin"),
  );

  dom.candidateEditor.addEventListener("click", (event) => {
    const button = event.target.closest(".remove-candidate-button");
    if (!button) {
      return;
    }

    runWithErrorHandling(() => removeCandidate(button.dataset.candidateId), "admin");
  });

  dom.customOfficeForm.addEventListener("submit", (event) =>
    runWithErrorHandling(async () => {
      event.preventDefault();
      await addCustomOffice();
    }, "admin"),
  );

  dom.memberDirectoryCard.addEventListener("click", (event) => {
    const roleButton = event.target.closest(".member-role-button");
    if (roleButton) {
      runWithErrorHandling(
        () => handleRoleChange(roleButton.dataset.memberId, roleButton.dataset.role),
        "admin",
      );
      return;
    }

    const kickButton = event.target.closest(".member-kick-button");
    if (kickButton) {
      runWithErrorHandling(() => handleKickMember(kickButton.dataset.memberId), "admin");
    }
  });
}

function cacheDom() {
  [
    "backendBadge",
    "authBadge",
    "authMessage",
    "credentialBlock",
    "presidentAccessBlock",
    "memberNameInput",
    "memberPasswordInput",
    "memberStatusInput",
    "memberSignInButton",
    "memberSignUpButton",
    "presidentPasswordInput",
    "presidentSignInButton",
    "backendHelpText",
    "profileBlock",
    "profileHeading",
    "profileSummaryText",
    "profileForm",
    "profileDisplayName",
    "profileMemberStatus",
    "profilePassword",
    "signOutButton",
    "localToolsBlock",
    "resetDemoButton",
    "memberViewButton",
    "presidentViewButton",
    "phaseBanner",
    "timerLabel",
    "timerValue",
    "timerMeta",
    "currentOfficeName",
    "currentOfficeMeta",
    "currentCandidateName",
    "currentCandidateMeta",
    "officeDetailCard",
    "candidateList",
    "ballotStatusPill",
    "ballotNotice",
    "ballotForm",
    "voteReceipt",
    "officeQueue",
    "presidentPanel",
    "presidentRoleBadge",
    "presidentLockNotice",
    "onlineMembersCard",
    "memberDirectoryCard",
    "activeOfficeSelect",
    "activeCandidateSelect",
    "announcementInput",
    "saveBoardButton",
    "speechButton",
    "qaButton",
    "discussionButton",
    "openVoteButton",
    "closeVoteButton",
    "extendButton",
    "resetPhaseButton",
    "editOfficeSelect",
    "candidateEditor",
    "candidateForm",
    "candidateNameInput",
    "candidateNoteInput",
    "customOfficeForm",
    "customOfficeNameInput",
    "customOfficeBallotType",
    "customOfficeCategory",
    "resultsOfficeSelect",
    "resultsCard",
  ].forEach((id) => {
    dom[id] = qs(id);
  });
}

function startBackgroundSync() {
  if (app.syncHandle) {
    window.clearInterval(app.syncHandle);
  }

  if (app.tickerHandle) {
    window.clearInterval(app.tickerHandle);
  }

  app.syncHandle = window.setInterval(() => {
    runWithErrorHandling(refreshFromService, "auth");
  }, 8_000);

  app.tickerHandle = window.setInterval(() => {
    updateTimerDisplay();
  }, 1_000);
}

async function bootstrap() {
  cacheDom();
  app.service = buildElectionService(app.config);
  await refreshFromService();
  bindEvents();
  startBackgroundSync();
}

bootstrap().catch((error) => {
  console.error(error);
  const authMessage = qs("authMessage");
  if (authMessage) {
    authMessage.classList.remove("hidden");
    authMessage.textContent = error.message || "The election center could not start.";
  }
});
