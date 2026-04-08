"use strict";

const TWITCH_GQL_ENDPOINT = "https://gql.twitch.tv/gql";
const TWITCH_INTEGRITY_ENDPOINT = "https://gql.twitch.tv/integrity";
const TWITCH_GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

const IVR_MODVIP_ENDPOINT = "https://api.ivr.fi/v2/twitch/modvip/";
const IVR_FOUNDERS_ENDPOINT = "https://api.ivr.fi/v2/twitch/founders/";
const IVR_USER_ENDPOINT = "https://api.ivr.fi/v2/twitch/user?login=";

const DEVICE_ID_STORAGE_KEY = "twitch-tools-device-id";

const integrityState = {
  token: "",
  expiration: 0,
};

const els = {
  form: document.getElementById("lookup-form"),
  login: document.getElementById("login"),
  lookupButton: document.getElementById("lookup-button"),
  status: document.getElementById("global-status"),
  summary: document.getElementById("summary"),
  followingMeta: document.getElementById("following-meta"),
  followingOut: document.getElementById("following-output"),
  vipsOut: document.getElementById("vips-output"),
  modsOut: document.getElementById("mods-output"),
  foundersOut: document.getElementById("founders-output"),
  vipsCount: document.getElementById("vips-count"),
  modsCount: document.getElementById("mods-count"),
  foundersCount: document.getElementById("founders-count"),
  tabButtons: Array.from(document.querySelectorAll(".tab-btn")),
  tabPanels: Array.from(document.querySelectorAll(".tab-panel")),
};

els.form.addEventListener("submit", handleLookup);
els.tabButtons.forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab || ""));
});

renderEmptyState();

async function handleLookup(event) {
  event.preventDefault();
  const login = normalizeLogin(els.login.value);

  if (!login) {
    setStatus("Введите ник Twitch.", "error");
    els.login.focus();
    return;
  }

  setLoading(true);
  clearOutputs();
  setStatus("Загружаю данные...", "loading");

  const [followingRes, modVipRes, foundersRes] = await Promise.allSettled([
    fetchFollowing(login),
    fetchModVip(login),
    fetchFounders(login),
  ]);

  const counters = { following: 0, vips: 0, mods: 0, founders: 0 };
  let failures = 0;
  let hasWarnings = false;

  let followingRows = [];
  let vipRows = [];
  let modRows = [];
  let founderRows = [];
  let followingMeta = { total: null, shown: 0, warning: "" };

  if (followingRes.status === "fulfilled") {
    followingRows = followingRes.value.items;
    followingMeta = {
      total: followingRes.value.total,
      shown: followingRes.value.items.length,
      warning: followingRes.value.partialError || "",
    };
    counters.following = followingRows.length;
    if (followingRes.value.partialError) hasWarnings = true;
  } else {
    failures += 1;
    renderError(els.followingOut, followingRes.reason);
  }

  if (modVipRes.status === "fulfilled") {
    vipRows = modVipRes.value.vips;
    modRows = modVipRes.value.mods;
    counters.vips = vipRows.length;
    counters.mods = modRows.length;
  } else {
    failures += 1;
    renderError(els.vipsOut, modVipRes.reason);
    renderError(els.modsOut, modVipRes.reason);
  }

  if (foundersRes.status === "fulfilled") {
    founderRows = foundersRes.value;
    counters.founders = founderRows.length;
  } else {
    failures += 1;
    renderError(els.foundersOut, foundersRes.reason);
  }

  const allLogins = [
    ...followingRows.map((x) => x.login),
    ...vipRows.map((x) => x.login),
    ...modRows.map((x) => x.login),
    ...founderRows.map((x) => x.login),
  ];
  const profileMap = await buildProfileMap(allLogins);

  followingRows = applyProfileMap(followingRows, profileMap);
  vipRows = applyProfileMap(vipRows, profileMap);
  modRows = applyProfileMap(modRows, profileMap);
  founderRows = applyProfileMap(founderRows, profileMap);

  if (followingRes.status === "fulfilled") {
    renderFollowingCards(followingRows, followingMeta);
  }
  if (modVipRes.status === "fulfilled") {
    renderRoleCards(els.vipsOut, vipRows, "VIP не найдены");
    renderRoleCards(els.modsOut, modRows, "Модераторы не найдены");
  }
  if (foundersRes.status === "fulfilled") {
    renderRoleCards(els.foundersOut, founderRows, "Основатели не найдены");
  }

  els.vipsCount.textContent = String(counters.vips);
  els.modsCount.textContent = String(counters.mods);
  els.foundersCount.textContent = String(counters.founders);
  renderSummary(counters);

  if (failures === 0 && !hasWarnings) {
    setStatus("Готово. Данные загружены.", "ok");
  } else if (failures === 0 && hasWarnings) {
    setStatus("Данные загружены частично: Twitch ограничил часть страниц following.", "error");
  } else if (failures < 3) {
    setStatus("Часть данных загружена, часть запросов завершилась ошибкой.", "error");
  } else {
    setStatus("Не удалось загрузить данные. Проверь ник и доступность API.", "error");
  }

  setLoading(false);
}

function activateTab(tabId) {
  els.tabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tabId);
  });
  els.tabPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === tabId);
  });
}

function normalizeLogin(raw) {
  return String(raw || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function setLoading(isLoading) {
  els.lookupButton.disabled = isLoading;
  els.login.disabled = isLoading;
}

function setStatus(message, type) {
  els.status.textContent = message;
  els.status.classList.remove("loading", "error", "ok");
  if (type) els.status.classList.add(type);
}

function clearOutputs() {
  els.followingMeta.textContent = "";
  els.summary.innerHTML = "";
  els.followingOut.innerHTML = "";
  els.vipsOut.innerHTML = "";
  els.modsOut.innerHTML = "";
  els.foundersOut.innerHTML = "";
  els.vipsCount.textContent = "0";
  els.modsCount.textContent = "0";
  els.foundersCount.textContent = "0";
}

function renderEmptyState() {
  renderSummary({ following: 0, vips: 0, mods: 0, founders: 0 });
  els.vipsCount.textContent = "0";
  els.modsCount.textContent = "0";
  els.foundersCount.textContent = "0";
  els.followingMeta.textContent = "";
  els.followingOut.innerHTML = '<p class="empty">Список появится после запроса.</p>';
  els.vipsOut.innerHTML = '<p class="empty">Список появится после запроса.</p>';
  els.modsOut.innerHTML = '<p class="empty">Список появится после запроса.</p>';
  els.foundersOut.innerHTML = '<p class="empty">Список появится после запроса.</p>';
  setStatus("Введите ник и нажмите «Показать».", "");
  activateTab("following-tab");
}

function renderSummary(counters) {
  const cards = [
    { label: "Подписки", value: counters.following },
    { label: "VIP", value: counters.vips },
    { label: "Модераторы", value: counters.mods },
    { label: "Основатели", value: counters.founders },
  ];

  els.summary.innerHTML = cards
    .map(
      (card) => `
      <article class="metric">
        <p class="name">${escapeHtml(card.label)}</p>
        <p class="value">${escapeHtml(String(card.value))}</p>
      </article>
    `,
    )
    .join("");
}

function renderFollowingCards(rows, meta) {
  const notes = [];
  const totalText = Number.isFinite(meta.total) ? String(meta.total) : "n/a";
  notes.push(`Всего: ${totalText}`);
  notes.push(`Показано: ${rows.length}`);
  if (meta.warning) notes.push(`Остановлено: ${meta.warning}`);
  els.followingMeta.textContent = notes.join(" • ");

  if (rows.length === 0) {
    els.followingOut.innerHTML = '<p class="empty">Подписки не найдены.</p>';
    return;
  }

  renderUserGrid(els.followingOut, rows, { showDate: false });
}

function renderRoleCards(target, rows, emptyText) {
  const sorted = [...rows].sort((a, b) => timestampForSort(b.dateRaw) - timestampForSort(a.dateRaw));
  if (sorted.length === 0) {
    target.innerHTML = `<p class="empty">${escapeHtml(emptyText)}</p>`;
    return;
  }
  renderUserGrid(target, sorted, { showDate: true });
}

function renderUserGrid(target, rows, options) {
  const body = rows
    .map((row) => {
      const title = row.displayName || row.login || "unknown";
      const subtitle = options.showDate ? formatDate(row.dateRaw) : "";
      return `
        <article class="person-card">
          ${renderAvatar(row.avatarUrl, title)}
          <div class="person-meta">
            <p class="person-name">${escapeHtml(title)}</p>
            ${subtitle ? `<p class="person-sub">${escapeHtml(subtitle)}</p>` : ""}
          </div>
        </article>
      `;
    })
    .join("");

  target.innerHTML = `<div class="card-grid">${body}</div>`;
}

function renderAvatar(url, name) {
  if (url) {
    return `<img class="avatar" src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy" />`;
  }
  const letter = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return `<div class="avatar-fallback" aria-hidden="true">${escapeHtml(letter)}</div>`;
}

function renderError(target, error) {
  target.innerHTML = `<p class="error-box">${escapeHtml(humanError(error))}</p>`;
}

async function fetchFollowing(login) {
  try {
    return await fetchFollowingViaFollowsQuery(login);
  } catch (primaryError) {
    const text = humanError(primaryError);
    if (text.includes('Cannot query field "follows"')) {
      return fetchFollowingViaLegacyQuery(login);
    }
    throw primaryError;
  }
}

async function fetchFollowingViaFollowsQuery(login) {
  let cursor = null;
  let total = null;
  const items = [];
  const seenCursors = new Set();

  while (true) {
    const payload = {
      operationName: "UserFollows",
      variables: { login, first: 100, after: cursor },
      query: `
        query UserFollows($login: String!, $first: Int!, $after: Cursor) {
          user(login: $login) {
            follows(first: $first, after: $after) {
              totalCount
              edges {
                cursor
                node {
                  login
                  displayName
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
    };

    let json;
    try {
      json = await postGql(payload);
    } catch (error) {
      if (items.length > 0) {
        return { total, items, partialError: humanError(error) };
      }
      throw normalizeFollowingError(error);
    }

    const user = json?.data?.user;
    if (!user) throw new Error("Пользователь не найден в Twitch.");

    const follows = user.follows;
    total = follows?.totalCount ?? total;
    const edges = Array.isArray(follows?.edges) ? follows.edges : [];
    for (const edge of edges) {
      items.push({
        login: normalizeLogin(edge?.node?.login || ""),
        displayName: edge?.node?.displayName || edge?.node?.login || "",
        avatarUrl: "",
      });
    }

    const hasNextPage = Boolean(follows?.pageInfo?.hasNextPage);
    const nextCursor = follows?.pageInfo?.endCursor || null;
    if (!hasNextPage || !nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return { total, items, partialError: "" };
}

async function fetchFollowingViaLegacyQuery(login) {
  let cursor = null;
  let total = null;
  const items = [];
  const seenCursors = new Set();

  while (true) {
    const payload = {
      operationName: "UserFollowing",
      variables: { login, first: 100, after: cursor },
      query: `
        query UserFollowing($login: String!, $first: Int!, $after: Cursor) {
          user(login: $login) {
            following(first: $first, after: $after) {
              total
              edges {
                cursor
                node {
                  login
                  displayName
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
    };

    let json;
    try {
      json = await postGql(payload);
    } catch (error) {
      if (items.length > 0) {
        return { total, items, partialError: humanError(error) };
      }
      throw normalizeFollowingError(error);
    }

    const user = json?.data?.user;
    if (!user) throw new Error("Пользователь не найден в Twitch.");

    const following = user.following;
    total = following?.total ?? total;
    const edges = Array.isArray(following?.edges) ? following.edges : [];
    for (const edge of edges) {
      items.push({
        login: normalizeLogin(edge?.node?.login || ""),
        displayName: edge?.node?.displayName || edge?.node?.login || "",
        avatarUrl: "",
      });
    }

    const hasNextPage = Boolean(following?.pageInfo?.hasNextPage);
    const nextCursor = following?.pageInfo?.endCursor || null;
    if (!hasNextPage || !nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return { total, items, partialError: "" };
}

function normalizeFollowingError(error) {
  const msg = humanError(error).toLowerCase();
  if (msg.includes("failed integrity check")) {
    return new Error("Twitch ограничил пагинацию following (failed integrity check).");
  }
  if (msg.includes("service error")) {
    return new Error("Twitch временно ограничивает публичный following.");
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function postGql(payload) {
  let json = await postGqlOnce(payload, false);
  let message = gqlErrorMessage(json);
  if (message.toLowerCase().includes("failed integrity check")) {
    json = await postGqlOnce(payload, true);
    message = gqlErrorMessage(json);
  }
  if (message) throw new Error(message);
  return json;
}

async function postGqlOnce(payload, forceRefreshIntegrity) {
  const headers = await buildGqlHeaders(forceRefreshIntegrity);
  const response = await fetch(TWITCH_GQL_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Following: HTTP ${response.status}`);
  return response.json();
}

function gqlErrorMessage(json) {
  if (!Array.isArray(json?.errors) || json.errors.length === 0) return "";
  return json.errors.map((x) => x?.message || "Unknown GQL error").join("; ");
}

async function buildGqlHeaders(forceRefreshIntegrity = false) {
  const deviceId = getOrCreateDeviceId();
  const token = await getIntegrityToken(deviceId, forceRefreshIntegrity);
  const headers = {
    "Client-ID": TWITCH_GQL_CLIENT_ID,
    "Content-Type": "application/json",
    "Device-ID": deviceId,
    "X-Device-Id": deviceId,
  };
  if (token) headers["Client-Integrity"] = token;
  return headers;
}

async function getIntegrityToken(deviceId, forceRefresh = false) {
  const now = Date.now();
  if (
    !forceRefresh &&
    integrityState.token &&
    Number.isFinite(integrityState.expiration) &&
    integrityState.expiration - 30_000 > now
  ) {
    return integrityState.token;
  }

  try {
    const response = await fetch(TWITCH_INTEGRITY_ENDPOINT, {
      method: "POST",
      headers: {
        "Client-ID": TWITCH_GQL_CLIENT_ID,
        "Device-ID": deviceId,
        "X-Device-Id": deviceId,
      },
    });
    if (!response.ok) return "";
    const json = await response.json();
    integrityState.token = typeof json?.token === "string" ? json.token : "";
    integrityState.expiration = Number(json?.expiration) || now + 60 * 60 * 1000;
    return integrityState.token;
  } catch {
    return "";
  }
}

function getOrCreateDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const generated = generateDeviceId();
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return generateDeviceId();
  }
}

function generateDeviceId() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchModVip(login) {
  const data = await fetchJson(`${IVR_MODVIP_ENDPOINT}${encodeURIComponent(login)}`);
  const modsRaw = pickArray(data, ["mods", "moderators", "mod"]);
  const vipsRaw = pickArray(data, ["vips", "vip"]);
  return {
    mods: modsRaw.map((x) => normalizeRoleEntry(x, "mod")),
    vips: vipsRaw.map((x) => normalizeRoleEntry(x, "vip")),
  };
}

async function fetchFounders(login) {
  try {
    const profileRows = await fetchUsersByLogins([login]);
    const channel = profileRows[0] || null;
    if (channel) {
      const isAffiliate = Boolean(channel?.roles?.isAffiliate);
      const isPartner = Boolean(channel?.roles?.isPartner);
      if (!isAffiliate && !isPartner) return [];
    }
  } catch {
    // Continue with founders endpoint.
  }

  const url = `${IVR_FOUNDERS_ENDPOINT}${encodeURIComponent(login)}`;
  try {
    const data = await fetchJson(url);
    const foundersRaw = pickArray(data, ["founders", "data"], true);
    return foundersRaw.map((x) => normalizeRoleEntry(x, "founder"));
  } catch (error) {
    const text = humanError(error).toLowerCase();
    if (text.includes("http 404") && text.includes("twitch/founders/")) {
      return [];
    }
    throw error;
  }
}

async function buildProfileMap(logins) {
  const rows = await fetchUsersByLogins(logins);
  const map = new Map();
  for (const row of rows) {
    const login = normalizeLogin(row?.login || "");
    if (!login) continue;
    map.set(login, {
      displayName: row?.displayName || row?.login || login,
      avatarUrl: row?.logo || "",
    });
  }
  return map;
}

async function fetchUsersByLogins(logins) {
  const unique = Array.from(
    new Set(
      logins
        .map((x) => normalizeLogin(x))
        .filter((x) => x.length > 0),
    ),
  );
  if (unique.length === 0) return [];

  const chunkSize = 25;
  const out = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const rows = await fetchUsersChunkAdaptive(chunk);
    out.push(...rows);
  }
  return out;
}

async function fetchUsersChunkAdaptive(chunk) {
  if (chunk.length === 0) return [];

  const url = `${IVR_USER_ENDPOINT}${encodeURIComponent(chunk.join(","))}`;
  try {
    const data = await fetchJson(url);
    return normalizeUserRows(data);
  } catch (error) {
    const text = humanError(error).toLowerCase();
    const isBadRequest = text.includes("http 400");
    if (!isBadRequest) {
      return [];
    }
    if (chunk.length === 1) {
      return [];
    }
    const mid = Math.floor(chunk.length / 2);
    const left = await fetchUsersChunkAdaptive(chunk.slice(0, mid));
    const right = await fetchUsersChunkAdaptive(chunk.slice(mid));
    return [...left, ...right];
  }
}

function normalizeUserRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.value)) return data.value;
  if (data && typeof data === "object" && typeof data.login === "string") return [data];
  return [];
}

function applyProfileMap(rows, profileMap) {
  return rows.map((row) => {
    const key = normalizeLogin(row.login || "");
    const profile = profileMap.get(key);
    return {
      ...row,
      displayName: row.displayName || profile?.displayName || row.login || "unknown",
      avatarUrl: row.avatarUrl || profile?.avatarUrl || "",
    };
  });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} (${url})`);
  }
  const json = await response.json();
  if (typeof json?.status === "number" && json.status >= 400) {
    throw new Error(json.message || `API error: ${json.status}`);
  }
  return json;
}

function pickArray(data, keys, allowRootArray = false) {
  if (allowRootArray && Array.isArray(data)) return data;
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

function normalizeRoleEntry(raw, role) {
  if (typeof raw === "string") {
    const login = normalizeLogin(raw);
    return { login, displayName: raw, avatarUrl: "", dateRaw: null };
  }
  const login = normalizeLogin(
    firstString(raw, ["login", "userLogin", "user_login", "name", "username", "userName"]),
  );
  const displayName = firstString(raw, [
    "displayName",
    "userDisplayName",
    "user_display_name",
    "name",
    "username",
    "userName",
    "login",
  ]);
  return {
    login: login || normalizeLogin(displayName) || "unknown",
    displayName: displayName || login || "unknown",
    avatarUrl: "",
    dateRaw: firstValue(raw, dateFieldsByRole(role)),
  };
}

function dateFieldsByRole(role) {
  const common = [
    "grantedAt",
    "granted_at",
    "createdAt",
    "created_at",
    "updatedAt",
    "updated_at",
    "since",
    "timestamp",
    "date",
  ];
  if (role === "vip") return ["vipSince", "vip_since", "vipAt", ...common];
  if (role === "mod") return ["modSince", "mod_since", "modAt", ...common];
  if (role === "founder") {
    return ["entitlementStart", "founderSince", "founder_since", "foundedAt", "subscribedAt", ...common];
  }
  return common;
}

function firstString(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstValue(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function timestampForSort(raw) {
  if (!raw) return 0;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) {
    if (asNumber > 0 && asNumber < 1e12) return asNumber * 1000;
    return asNumber;
  }
  const parsed = Date.parse(String(raw));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDate(raw) {
  if (!raw) return "Дата неизвестна";
  const stamp = timestampForSort(raw);
  if (!stamp) return String(raw);
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return String(raw);
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function humanError(error) {
  if (error instanceof Error) return error.message;
  return "Неизвестная ошибка запроса";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
