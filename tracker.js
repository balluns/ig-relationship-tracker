(async () => {
  "use strict";

  // Rimuovi istanza precedente se presente
  const oldModal = document.getElementById("ig-tracker-modal");
  if (oldModal) oldModal.remove();

  // AbortController per annullare le richieste attive se si chiude la modale
  let abortController = new AbortController();

  // --- UTILITY ---
  const sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });

  const getCookie = (name) => {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  };

  // Sanitizzazione XSS rigorosa
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));

  // LocalStorage protetto da try/catch
  const getStoredWhitelist = () => {
    try {
      return new Set(JSON.parse(localStorage.getItem("ig_tracker_whitelist") || "[]"));
    } catch (e) {
      console.warn("Impossibile leggere localStorage:", e);
      return new Set();
    }
  };

  const saveStoredWhitelist = (set) => {
    try {
      localStorage.setItem("ig_tracker_whitelist", JSON.stringify(Array.from(set)));
    } catch (e) {
      console.warn("Impossibile salvare su localStorage:", e);
    }
  };

  // --- RECUPERO USER ID SICURO ---
  const getMyUserId = async (signal) => {
    // 1. Cookie standard ds_user_id
    const cookieId = getCookie("ds_user_id");
    if (cookieId && /^\d+$/.test(cookieId)) return cookieId;

    // 2. Endpoint interno autenticato
    try {
      const res = await fetch("https://www.instagram.com/api/v1/accounts/current_user/?edit=true", {
        headers: { "x-ig-app-id": "936619743392459" },
        credentials: "include",
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.user?.pk) return String(data.user.pk);
      }
    } catch (e) {
      if (e.name === "AbortError") throw e;
    }

    // 3. Fallback stato globale
    if (window._sharedData?.config?.viewerId) {
      return String(window._sharedData.config.viewerId);
    }

    throw new Error("Impossibile identificare il tuo account. Assicurati di essere loggato su instagram.com.");
  };

  // --- COSTRUZIONE UI OVERLAY ---
  const modalContainer = document.createElement("div");
  modalContainer.id = "ig-tracker-modal";
  modalContainer.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.82);
    backdrop-filter: blur(8px); z-index: 9999999; display: flex;
    align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #fff; padding: 16px; box-sizing: border-box;
  `;

  modalContainer.innerHTML = `
    <div style="background: #181818; width: 100%; max-width: 680px; height: 86vh; border-radius: 14px; border: 1px solid #2d2d2d; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 16px 48px rgba(0,0,0,0.85); position: relative;">
      
      <!-- Toast Notification Bar In-App -->
      <div id="ig-toast" style="position: absolute; top: 12px; left: 50%; transform: translateX(-50%); background: #222; border: 1px solid #444; color: #fff; padding: 8px 16px; border-radius: 20px; font-size: 12px; font-weight: 500; display: none; z-index: 100; box-shadow: 0 4px 16px rgba(0,0,0,0.6); pointer-events: none; transition: opacity 0.2s ease;"></div>

      <!-- Header -->
      <div style="padding: 16px 20px; border-bottom: 1px solid #262626; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="background: linear-gradient(45deg, #f09433, #dc2743, #bc1888); width: 26px; height: 26px; border-radius: 7px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 13px;">IG</div>
          <h2 style="margin: 0; font-size: 16px; font-weight: 600;">Instagram Relationship Tracker</h2>
        </div>
        <button id="ig-close-btn" style="background: none; border: none; color: #888; font-size: 24px; cursor: pointer; line-height: 1;">&times;</button>
      </div>

      <!-- Status Bar -->
      <div id="ig-status-bar" style="padding: 10px 20px; background: #202020; font-size: 13px; color: #aaa; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #262626;">
        <span id="ig-status-text">Pronto per la scansione.</span>
        <button id="ig-start-btn" style="background: #0095f6; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;">Avvia Scansione</button>
      </div>

      <!-- Live Progress Bar -->
      <div id="ig-progress-container" style="display: none; height: 3px; background: #262626; width: 100%;">
        <div id="ig-progress-bar" style="width: 0%; height: 100%; background: #0095f6; transition: width 0.2s ease;"></div>
      </div>

      <!-- Tabs & Search -->
      <div style="padding: 12px 20px; display: flex; flex-direction: column; gap: 10px; border-bottom: 1px solid #262626;">
        <div style="display: flex; gap: 8px; overflow-x: auto;">
          <button class="ig-tab active" data-tab="notFollowingBack" style="background: #333; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer; white-space: nowrap;">Non ricambiano (<span id="count-notFollowingBack">0</span>)</button>
          <button class="ig-tab" data-tab="fans" style="background: transparent; color: #888; border: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer; white-space: nowrap;">Fan (<span id="count-fans">0</span>)</button>
          <button class="ig-tab" data-tab="mutual" style="background: transparent; color: #888; border: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer; white-space: nowrap;">Reciproci (<span id="count-mutual">0</span>)</button>
          <button class="ig-tab" data-tab="whitelist" style="background: transparent; color: #888; border: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer; white-space: nowrap;">Whitelist (<span id="count-whitelist">0</span>)</button>
        </div>
        <div style="display: flex; gap: 10px;">
          <input type="text" id="ig-search-input" placeholder="Cerca per username o nome..." style="flex: 1; background: #242424; border: 1px solid #333; border-radius: 6px; padding: 8px 12px; color: #fff; font-size: 13px; outline: none;">
          <button id="ig-copy-btn" style="background: #2a2a2a; color: #fff; border: 1px solid #383838; padding: 8px 14px; border-radius: 6px; font-size: 13px; cursor: pointer; white-space: nowrap;">📋 Copia</button>
        </div>
      </div>

      <!-- Users List -->
      <div id="ig-users-list" style="flex: 1; overflow-y: auto; padding: 12px 20px; display: flex; flex-direction: column; gap: 8px;">
        <div style="text-align: center; color: #666; margin-top: 40px; font-size: 13px;">Premi su "Avvia Scansione" per analizzare il profilo.</div>
      </div>

      <!-- Footer -->
      <div style="padding: 10px 20px; background: #131313; border-top: 1px solid #222; font-size: 11px; color: #777; display: flex; justify-content: space-between; align-items: center;">
        <span id="ig-scan-state">Nessuna scansione eseguita</span>
        <span>Seguiti: <b id="total-following">0</b> | Follower: <b id="total-followers">0</b></span>
      </div>
    </div>
  `;

  document.body.appendChild(modalContainer);

  // Sistema Toast In-App
  let toastTimer;
  const showToast = (msg, color = "#fff") => {
    const toast = document.getElementById("ig-toast");
    toast.textContent = msg;
    toast.style.color = color;
    toast.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.display = "none";
    }, 3200);
  };

  const closeModal = () => {
    abortController.abort();
    modalContainer.remove();
  };
  document.getElementById("ig-close-btn").onclick = closeModal;

  // --- STATO APPLICATIVO ---
  let allFollowing = [];
  let allFollowers = [];
  let categorized = { notFollowingBack: [], fans: [], mutual: [], whitelist: [] };
  let currentTab = "notFollowingBack";
  let searchQuery = "";
  let isScanning = false;
  let visibleLimit = 50;

  // Rate-limiting sugli unfollow per prevenire il ban
  let lastUnfollowTime = 0;
  const MIN_UNFOLLOW_COOLDOWN_MS = 3000;

  // --- FETCHING PAGINATO ROBUSTO ---
  const fetchList = async (userId, type, onProgress, signal) => {
    const usersMap = new Map();
    let maxId = null;
    let hasMore = true;
    let previousMaxId = null;

    const baseHeaders = {
      "x-ig-app-id": "936619743392459",
      "x-asbd-id": "129477",
      "x-requested-with": "XMLHttpRequest",
    };
    const csrf = getCookie("csrftoken");
    if (csrf) baseHeaders["x-csrftoken"] = csrf;

    while (hasMore) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");

      let url = `https://www.instagram.com/api/v1/friendships/${userId}/${type}/?count=50`;
      if (type === "followers") url += "&search_surface=follow_list_page";
      if (maxId) url += `&max_id=${encodeURIComponent(maxId)}`;

      let res = null;
      let retries = 0;

      // Gestione retry solida: nessun loop infinito
      while (retries < 3) {
        try {
          res = await fetch(url, { headers: baseHeaders, credentials: "include", signal });

          if (res.status === 429) {
            retries++;
            onProgress(`Rate limit rilevato (HTTP 429). Pausa di 15s (tentativo ${retries}/3)...`, usersMap.size);
            await sleep(15000, signal);
            continue;
          }

          if (res.ok) break;

          retries++;
          onProgress(`Errore HTTP ${res.status}. Tentativo ${retries}/3 tra 3s...`, usersMap.size);
          await sleep(3000, signal);
        } catch (err) {
          if (err.name === "AbortError") throw err;
          retries++;
          onProgress(`Errore di rete. Tentativo ${retries}/3 tra 3s...`, usersMap.size);
          await sleep(3000, signal);
        }
      }

      if (!res || !res.ok) {
        throw new Error(`Scansione di ${type} interrotta su HTTP ${res?.status || "network error"}.`);
      }

      const data = await res.json();
      if (data.status !== "ok" || !Array.isArray(data.users)) {
        throw new Error(data.message || `Risposta non valida da Instagram per ${type}.`);
      }

      for (const u of data.users) {
        const id = String(u.pk || u.id);
        if (!usersMap.has(id)) {
          usersMap.set(id, {
            id,
            username: String(u.username),
            full_name: String(u.full_name || ""),
            profile_pic_url: u.profile_pic_url || "",
            is_private: Boolean(u.is_private),
            is_verified: Boolean(u.is_verified),
          });
        }
      }

      previousMaxId = maxId;
      maxId = data.next_max_id;

      if (!maxId || maxId === previousMaxId) {
        hasMore = false;
      } else {
        hasMore = Boolean(data.big_list ?? true);
      }

      onProgress(`Scaricati ${usersMap.size} ${type}...`, usersMap.size);
      await sleep(1000 + Math.random() * 800, signal);
    }

    return Array.from(usersMap.values());
  };

  // --- CALCOLO INSIEMI ---
  const computeLists = () => {
    const whitelist = getStoredWhitelist();
    const followerMap = new Map(allFollowers.map((u) => [u.id, u]));
    const followingMap = new Map(allFollowing.map((u) => [u.id, u]));

    categorized.whitelist = allFollowing.filter((u) => whitelist.has(u.id));
    categorized.notFollowingBack = allFollowing.filter((u) => !followerMap.has(u.id) && !whitelist.has(u.id));
    categorized.fans = allFollowers.filter((u) => !followingMap.has(u.id));
    categorized.mutual = allFollowing.filter((u) => followerMap.has(u.id));

    document.getElementById("count-notFollowingBack").textContent = categorized.notFollowingBack.length;
    document.getElementById("count-fans").textContent = categorized.fans.length;
    document.getElementById("count-mutual").textContent = categorized.mutual.length;
    document.getElementById("count-whitelist").textContent = categorized.whitelist.length;
    document.getElementById("total-following").textContent = allFollowing.length;
    document.getElementById("total-followers").textContent = allFollowers.length;

    renderList();
  };

  // --- RENDERING CON UI CONTESTUALE ---
  const renderList = () => {
    const listEl = document.getElementById("ig-users-list");
    let items = categorized[currentTab] || [];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((u) => u.username.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q));
    }

    if (items.length === 0) {
      listEl.innerHTML = `<div style="text-align: center; color: #666; margin-top: 40px; font-size: 13px;">Nessun utente trovato in questa sezione.</div>`;
      return;
    }

    const whitelist = getStoredWhitelist();
    const displayedItems = items.slice(0, visibleLimit);

    listEl.innerHTML = displayedItems
      .map((user) => {
        const isWhitelisted = whitelist.has(user.id);
        const safeUsername = esc(user.username);
        const safeFullName = esc(user.full_name);
        const safePic = esc(user.profile_pic_url);

        // Nel tab Fan mostriamo il badge verde, non il pulsante di unfollow!
        let actionBtnHtml = "";
        if (currentTab === "fans") {
          actionBtnHtml = `<span style="color: #4caf50; font-size: 11px; background: rgba(76,175,80,0.12); border: 1px solid rgba(76,175,80,0.3); border-radius: 4px; padding: 4px 8px;">Ti segue</span>`;
        } else {
          actionBtnHtml = `
            <button class="unfollow-btn" data-id="${user.id}" data-username="${safeUsername}" style="background: #dc2743; color: #fff; border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; font-weight: 500;">
              Non seguire
            </button>
          `;
        }

        return `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #1f1f1f; border-radius: 8px; border: 1px solid #282828;">
          <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
            <img src="${safePic}" loading="lazy" onerror="this.onerror=null;this.src='https://static.cdninstagram.com/rsrc.php/v3/y6/r/_j_hL6y04g0.png';" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: #2a2a2a;" alt="" />
            <div style="overflow: hidden;">
              <div style="display: flex; align-items: center; gap: 4px;">
                <a href="https://www.instagram.com/${safeUsername}/" target="_blank" rel="noopener noreferrer" style="color: #fff; font-weight: 600; text-decoration: none; font-size: 13px;">${safeUsername}</a>
                ${user.is_verified ? '<span style="color: #0095f6; font-size: 12px;">✓</span>' : ""}
                ${user.is_private ? '<span style="color: #888; font-size: 10px; border: 1px solid #444; border-radius: 4px; padding: 0 3px;">Privato</span>' : ""}
              </div>
              <div style="font-size: 12px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">${safeFullName}</div>
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button class="toggle-whitelist-btn" data-id="${user.id}" title="${isWhitelisted ? "Rimuovi da Whitelist" : "Aggiungi a Whitelist"}" style="background: ${isWhitelisted ? "#ffc107" : "#2b2b2b"}; color: ${isWhitelisted ? "#000" : "#bbb"}; border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px;">★</button>
            ${actionBtnHtml}
          </div>
        </div>
      `;
      })
      .join("");

    if (items.length > visibleLimit) {
      const loadMoreBtn = document.createElement("button");
      loadMoreBtn.textContent = `Carica altri (${items.length - visibleLimit} rimanenti)`;
      loadMoreBtn.style.cssText = "background: #262626; color: #bbb; border: 1px solid #333; padding: 8px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-top: 4px;";
      loadMoreBtn.onclick = () => {
        visibleLimit += 50;
        renderList();
      };
      listEl.appendChild(loadMoreBtn);
    }
  };

  // --- EVENT DELEGATION ROBUSTA ---
  const usersListEl = document.getElementById("ig-users-list");

  usersListEl.addEventListener("click", async (e) => {
    // 1. Whitelist toggle
    const wlBtn = e.target.closest(".toggle-whitelist-btn");
    if (wlBtn) {
      const id = wlBtn.dataset.id;
      const wl = getStoredWhitelist();
      if (wl.has(id)) wl.delete(id);
      else wl.add(id);
      saveStoredWhitelist(wl);
      computeLists();
      return;
    }

    // 2. Unfollow con Pattern di conferma non bloccante e Cooldown anti-ban
    const unfollowBtn = e.target.closest(".unfollow-btn");
    if (unfollowBtn) {
      const id = unfollowBtn.dataset.id;
      const username = unfollowBtn.dataset.username;

      // Rate limit check lato client
      const now = Date.now();
      if (now - lastUnfollowTime < MIN_UNFOLLOW_COOLDOWN_MS) {
        showToast("Attendi qualche secondo tra gli unfollow per proteggere l'account!", "#ff9800");
        return;
      }

      // Pattern Inline Confirm (due clic per confermare)
      if (!unfollowBtn.dataset.confirming) {
        unfollowBtn.dataset.confirming = "true";
        unfollowBtn.textContent = "Confermi?";
        unfollowBtn.style.background = "#e65100";
        setTimeout(() => {
          if (unfollowBtn && unfollowBtn.dataset.confirming === "true") {
            delete unfollowBtn.dataset.confirming;
            unfollowBtn.textContent = "Non seguire";
            unfollowBtn.style.background = "#dc2743";
          }
        }, 3000);
        return;
      }

      delete unfollowBtn.dataset.confirming;
      unfollowBtn.disabled = true;
      unfollowBtn.textContent = "Attendere...";

      const csrf = getCookie("csrftoken");
      try {
        lastUnfollowTime = Date.now();
        const res = await fetch(`https://www.instagram.com/api/v1/friendships/destroy/${id}/`, {
          method: "POST",
          headers: {
            "x-csrftoken": csrf || "",
            "x-ig-app-id": "936619743392459",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: `csrf_token=${encodeURIComponent(csrf || "")}`,
          credentials: "include",
        });

        if (res.ok) {
          unfollowBtn.textContent = "Rimosso ✓";
          unfollowBtn.style.background = "#2e7d32";
          showToast(`Hai smesso di seguire @${username}`, "#4caf50");
          allFollowing = allFollowing.filter((u) => u.id !== id);
          setTimeout(computeLists, 600);
        } else {
          showToast("Azione limitata da Instagram. Riprova più tardi.", "#f44336");
          unfollowBtn.textContent = "Errore";
          unfollowBtn.disabled = false;
        }
      } catch {
        showToast("Errore di connessione.", "#f44336");
        unfollowBtn.textContent = "Errore";
        unfollowBtn.disabled = false;
      }
    }
  });

  // Switch Tab
  document.querySelectorAll(".ig-tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll(".ig-tab").forEach((t) => {
        t.style.background = "transparent";
        t.style.color = "#888";
      });
      tab.style.background = "#333";
      tab.style.color = "#fff";
      currentTab = tab.dataset.tab;
      visibleLimit = 50;
      renderList();
    };
  });

  // Ricerca fluida senza perdita di focus
  let searchTimer;
  document.getElementById("ig-search-input").oninput = (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = e.target.value;
      visibleLimit = 50;
      renderList();
    }, 120);
  };

  // Copia lista negli appunti
  document.getElementById("ig-copy-btn").onclick = async () => {
    const items = categorized[currentTab] || [];
    if (!items.length) return showToast("Nessun utente nella lista da copiare.");
    const text = items.map((u) => `@${u.username}`).join("\n");
    await navigator.clipboard.writeText(text);
    showToast(`Copiati ${items.length} username negli appunti!`, "#4caf50");
  };

  // --- AVVIO SCANSIONE CON FEEDBACK REALE ---
  document.getElementById("ig-start-btn").onclick = async () => {
    if (isScanning) return;
    isScanning = true;

    const startBtn = document.getElementById("ig-start-btn");
    const statusText = document.getElementById("ig-status-text");
    const progContainer = document.getElementById("ig-progress-container");
    const progBar = document.getElementById("ig-progress-bar");
    const scanState = document.getElementById("ig-scan-state");

    startBtn.disabled = true;
    startBtn.style.opacity = "0.5";
    progContainer.style.display = "block";
    progBar.style.width = "10%";
    scanState.textContent = "Scansione in corso...";

    abortController = new AbortController();
    const signal = abortController.signal;

    try {
      statusText.textContent = "Rilevamento User ID...";
      const myId = await getMyUserId(signal);

      // Fase 1: Scarica i Seguiti
      progBar.style.width = "30%";
      allFollowing = await fetchList(
        myId,
        "following",
        (msg) => {
          statusText.textContent = `[1/2 Seguiti] ${msg}`;
        },
        signal
      );

      // Fase 2: Scarica i Follower
      progBar.style.width = "70%";
      allFollowers = await fetchList(
        myId,
        "followers",
        (msg) => {
          statusText.textContent = `[2/2 Follower] ${msg}`;
        },
        signal
      );

      progBar.style.width = "100%";
      statusText.textContent = "Scansione terminata con successo!";
      scanState.textContent = "Scansione completata al 100%";
      showToast("Scansione completata con successo!", "#4caf50");

      computeLists();
    } catch (err) {
      if (err.name === "AbortError") {
        console.log("Scansione annullata.");
      } else {
        console.error(err);
        statusText.textContent = `Errore: ${err.message}`;
        scanState.textContent = "Scansione fallita";
        showToast(err.message, "#f44336");
      }
    } finally {
      isScanning = false;
      startBtn.disabled = false;
      startBtn.style.opacity = "1";
      startBtn.textContent = "Riscansiona";
    }
  };
})();
