(async () => {
  "use strict";

  // 1. Interrompi eventuale scansione precedente ancora in esecuzione
  if (window.__igTrackerAbort) {
    try {
      window.__igTrackerAbort.abort();
    } catch (_) {}
  }

  // Rimuovi eventuale modale precedente dal DOM
  const existingModal = document.getElementById("ig-tracker-modal");
  if (existingModal) existingModal.remove();

  // Nuovo AbortController globale per prevenire ghost runs
  let abortController = new AbortController();
  window.__igTrackerAbort = abortController;

  const FALLBACK_AVATAR = "https://static.cdninstagram.com/rsrc.php/v3/y6/r/_j_hL6y04g0.png";
  const STORAGE_KEY = "ig_tracker_whitelist_v2";
  const STORAGE_HOURLY_KEY = "ig_hourly_unfollows_v2";
  const STORAGE_BLOCK_KEY = "ig_unfollow_block_until_v2";
  const MAX_HOURLY_UNFOLLOWS = 30;

  // --- UTILITY ---
  // Sleep con rimozione esplicita del listener su signal (zero memory leaks)
  const sleep = (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });

  const getCookie = (name) => {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  };

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));

  // LocalStorage protetto per Whitelist
  const getStoredWhitelist = () => {
    try {
      return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
    } catch (_) {
      return new Set();
    }
  };

  const saveStoredWhitelist = (set) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch (e) {
      console.warn("Impossibile salvare su localStorage:", e);
    }
  };

  // Tetto orario persistente su localStorage (valido tra schede e dopo il reload)
  const getHourlyUnfollows = () => {
    try {
      const raw = localStorage.getItem(STORAGE_HOURLY_KEY);
      const list = raw ? JSON.parse(raw) : [];
      const now = Date.now();
      return list.filter((t) => now - t < 3600000);
    } catch (_) {
      return [];
    }
  };

  const recordUnfollowAction = () => {
    const list = getHourlyUnfollows();
    list.push(Date.now());
    try {
      localStorage.setItem(STORAGE_HOURLY_KEY, JSON.stringify(list));
    } catch (_) {}
  };

  // Blocco temporaneo di sicurezza da Instagram (feedback_required / 429) per 30 minuti
  const getBlockUntil = () => {
    try {
      return Number(localStorage.getItem(STORAGE_BLOCK_KEY) || 0);
    } catch (_) {
      return 0;
    }
  };

  const setBlockUntil = (ms) => {
    try {
      localStorage.setItem(STORAGE_BLOCK_KEY, String(ms));
    } catch (_) {}
  };

  // --- RECUPERO ACCOUNT CON VALIDAZIONE RIGOROSA E FALLBACK UNIVERSALE ---
  const getAccountInfo = async (signal) => {
    const rawCookie = getCookie("ds_user_id");
    let userId = rawCookie && /^\d+$/.test(rawCookie) ? rawCookie : null;
    let username = null;
    let followingCount = 0;
    let followersCount = 0;

    try {
      const res = await fetch("https://www.instagram.com/api/v1/accounts/current_user/?edit=true", {
        headers: { "x-ig-app-id": "936619743392459" },
        credentials: "include",
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.user?.pk) {
          userId = String(data.user.pk);
          username = data.user.username;
        }
      }
    } catch (e) {
      if (e.name === "AbortError") throw e;
    }

    if (!userId && window._sharedData?.config?.viewerId) {
      const vId = String(window._sharedData.config.viewerId);
      if (/^\d+$/.test(vId)) userId = vId;
    }

    // Fallback username universale (esclude tutte le rotte di sistema note)
    if (!username) {
      try {
        const navLinks = Array.from(document.querySelectorAll('nav a[href^="/"], div[role="navigation"] a[href^="/"]'));
        const systemRoutes = new Set([
          "", "explore", "reels", "direct", "notifications", "create", 
          "stories", "accounts", "threads", "ads", "about", "help", "meta"
        ]);
        for (const link of navLinks) {
          const path = (link.getAttribute("href") || "").replace(/^\/|\/$/g, "").split("/")[0];
          if (path && !systemRoutes.has(path.toLowerCase()) && !path.startsWith("p/")) {
            username = path;
            break;
          }
        }
      } catch (_) {}
    }

    if (!userId) {
      throw new Error("Impossibile identificare lo User ID. Assicurati di essere loggato su instagram.com.");
    }

    // Recupera conteggi reali per validazione completezza
    if (username) {
      try {
        const pRes = await fetch(
          `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
          {
            headers: { "x-ig-app-id": "936619743392459" },
            credentials: "include",
            signal,
          }
        );
        if (pRes.ok) {
          const pData = await pRes.json();
          const u = pData?.data?.user;
          if (u) {
            followingCount = Number(u.edge_follow?.count) || 0;
            followersCount = Number(u.edge_followed_by?.count) || 0;
          }
        }
      } catch (_) {}
    }

    return { userId, username, followingCount, followersCount };
  };

  // --- CREAZIONE UI OVERLAY ---
  const modalContainer = document.createElement("div");
  modalContainer.id = "ig-tracker-modal";
  modalContainer.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.84);
    backdrop-filter: blur(8px); z-index: 9999999; display: flex;
    align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #fff; padding: 16px; box-sizing: border-box;
  `;

  modalContainer.innerHTML = `
    <div style="background: #181818; width: 100%; max-width: 680px; height: 86vh; border-radius: 14px; border: 1px solid #2d2d2d; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 16px 48px rgba(0,0,0,0.85); position: relative;">
      
      <!-- Toast in-app non bloccante -->
      <div id="ig-toast" style="position: absolute; top: 12px; left: 50%; transform: translateX(-50%); background: #222; border: 1px solid #444; color: #fff; padding: 8px 16px; border-radius: 20px; font-size: 12px; font-weight: 500; display: none; z-index: 100; box-shadow: 0 4px 16px rgba(0,0,0,0.6); pointer-events: none; transition: opacity 0.2s ease; text-align: center; max-width: 90%;"></div>

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
        <span id="ig-status-text">Pronto per iniziare.</span>
        <button id="ig-start-btn" style="background: #0095f6; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;">Avvia Scansione</button>
      </div>

      <!-- Progress Bar Reale -->
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
          <input type="text" id="ig-search-input" placeholder="Cerca username o nome..." style="flex: 1; background: #242424; border: 1px solid #333; border-radius: 6px; padding: 8px 12px; color: #fff; font-size: 13px; outline: none;">
          <button id="ig-copy-btn" style="background: #2a2a2a; color: #fff; border: 1px solid #383838; padding: 8px 14px; border-radius: 6px; font-size: 13px; cursor: pointer; white-space: nowrap;">📋 Copia</button>
        </div>
      </div>

      <!-- Users List -->
      <div id="ig-users-list" style="flex: 1; overflow-y: auto; padding: 12px 20px; display: flex; flex-direction: column; gap: 8px;">
        <div style="text-align: center; color: #666; margin-top: 40px; font-size: 13px;">Premi su "Avvia Scansione" per caricare follower e seguiti.</div>
      </div>

      <!-- Footer con timestamp e integrità -->
      <div style="padding: 10px 20px; background: #131313; border-top: 1px solid #222; font-size: 11px; color: #777; display: flex; justify-content: space-between; align-items: center;">
        <span id="ig-scan-state">Nessuna scansione eseguita</span>
        <span>Seguiti: <b id="total-following">0</b> | Follower: <b id="total-followers">0</b></span>
      </div>
    </div>
  `;

  document.body.appendChild(modalContainer);

  let toastTimer;
  const showToast = (msg, color = "#fff") => {
    if (!modalContainer.isConnected) return;
    const toast = document.getElementById("ig-toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.style.color = color;
    toast.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toast) toast.style.display = "none";
    }, 3500);
  };

  const closeModal = () => {
    abortController.abort();
    modalContainer.remove();
  };
  document.getElementById("ig-close-btn").onclick = closeModal;

  // Fallback immagini rotte compatibile con CSP (Capture Phase)
  const usersListEl = document.getElementById("ig-users-list");
  usersListEl.addEventListener(
    "error",
    (e) => {
      if (e.target && e.target.tagName === "IMG" && !e.target.dataset.fb) {
        e.target.dataset.fb = "1";
        e.target.src = FALLBACK_AVATAR;
      }
    },
    true
  );

  // --- STATO APPLICATIVO ---
  let allFollowing = [];
  let allFollowers = [];
  let categorized = { notFollowingBack: [], fans: [], mutual: [], whitelist: [] };
  let currentTab = "notFollowingBack";
  let searchQuery = "";
  let isScanning = false;
  let visibleLimit = 50;

  // Controllo integrità completezza dati
  let dataTrusted = false;

  // Mutex per evitare unfollow concorrenti in volo
  let unfollowInFlight = false;

  // Cooldown deterministico e gestione singolo pulsante in conferma
  let nextAllowedUnfollowAt = 0;
  let activeConfirmingBtn = null;

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

      while (retries < 3) {
        try {
          res = await fetch(url, { headers: baseHeaders, credentials: "include", signal });

          if (res.status === 429) {
            retries++;
            if (retries >= 3) break;
            onProgress(`Rate limit (429). Pausa di 15s (${retries}/3)...`, usersMap.size);
            await sleep(15000, signal);
            continue;
          }

          if (res.ok) break;

          retries++;
          if (retries >= 3) break;
          onProgress(`HTTP ${res.status}. Tentativo ${retries}/3 tra 3s...`, usersMap.size);
          await sleep(3000, signal);
        } catch (err) {
          if (err.name === "AbortError") throw err;
          retries++;
          if (retries >= 3) break;
          onProgress(`Errore di rete. Tentativo ${retries}/3 tra 3s...`, usersMap.size);
          await sleep(3000, signal);
        }
      }

      if (!res || !res.ok) {
        throw new Error(`Scansione di ${type} interrotta (HTTP ${res?.status || "network error"}).`);
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
      maxId = data.next_max_id ? String(data.next_max_id) : null;
      hasMore = Boolean(maxId && maxId !== previousMaxId);

      onProgress(`Scaricati ${usersMap.size} ${type}...`, usersMap.size);
      await sleep(1000 + Math.random() * 800, signal);
    }

    return Array.from(usersMap.values());
  };

  // --- CALCOLO INSIEMI ---
  const computeLists = () => {
    if (!modalContainer.isConnected) return;

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
    if (!modalContainer.isConnected) return;
    activeConfirmingBtn = null;

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
        const safeId = esc(user.id);
        const safeUsername = esc(user.username);
        const encodedUrlUsername = encodeURIComponent(user.username);
        const safeFullName = esc(user.full_name);
        const safePic = esc(user.profile_pic_url);

        let controlsHtml = "";

        if (currentTab === "fans") {
          controlsHtml = `<span style="color: #4caf50; font-size: 11px; background: rgba(76,175,80,0.12); border: 1px solid rgba(76,175,80,0.3); border-radius: 4px; padding: 4px 8px;">Ti segue</span>`;
        } else if (currentTab === "whitelist") {
          controlsHtml = `
            <button class="toggle-whitelist-btn" data-id="${safeId}" title="Rimuovi da Whitelist" style="background: #ffc107; color: #000; border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px;">★ Rimuovi</button>
            <span style="color: #ffc107; font-size: 11px; background: rgba(255,193,7,0.12); border: 1px solid rgba(255,193,7,0.3); border-radius: 4px; padding: 4px 8px;">Protetto 🛡️</span>
          `;
        } else {
          controlsHtml = `
            <button class="toggle-whitelist-btn" data-id="${safeId}" title="${isWhitelisted ? "Rimuovi da Whitelist" : "Aggiungi a Whitelist"}" style="background: ${isWhitelisted ? "#ffc107" : "#2b2b2b"}; color: ${isWhitelisted ? "#000" : "#bbb"}; border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px;">★</button>
            <button class="unfollow-btn" data-id="${safeId}" data-username="${safeUsername}" style="background: #dc2743; color: #fff; border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; font-weight: 500;">Non seguire</button>
          `;
        }

        return `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #1f1f1f; border-radius: 8px; border: 1px solid #282828;">
          <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
            <img src="${safePic}" loading="lazy" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: #2a2a2a;" alt="" />
            <div style="overflow: hidden;">
              <div style="display: flex; align-items: center; gap: 4px;">
                <a href="https://www.instagram.com/${encodedUrlUsername}/" target="_blank" rel="noopener noreferrer" style="color: #fff; font-weight: 600; text-decoration: none; font-size: 13px;">${safeUsername}</a>
                ${user.is_verified ? '<span style="color: #0095f6; font-size: 12px;">✓</span>' : ""}
                ${user.is_private ? '<span style="color: #888; font-size: 10px; border: 1px solid #444; border-radius: 4px; padding: 0 3px;">Privato</span>' : ""}
              </div>
              <div style="font-size: 12px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">${safeFullName}</div>
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            ${controlsHtml}
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

  // --- EVENT DELEGATION SULLA LISTA ---
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

    // 2. Unfollow con Protezioni Complete e Mutex
    const unfollowBtn = e.target.closest(".unfollow-btn");
    if (unfollowBtn) {
      if (isScanning) {
        showToast("Attendi il completamento della scansione in corso.", "#ff9800");
        return;
      }

      if (!dataTrusted) {
        showToast("Dati non verificati o incompleti. Riscansiona per abilitare gli unfollow.", "#ff9800");
        return;
      }

      const blockUntil = getBlockUntil();
      if (Date.now() < blockUntil) {
        const minLeft = Math.ceil((blockUntil - Date.now()) / 60000);
        showToast(`Unfollow sospesi: Instagram ha limitato le azioni. Attendi ${minLeft} min.`, "#f44336");
        return;
      }

      const hourly = getHourlyUnfollows();
      if (hourly.length >= MAX_HOURLY_UNFOLLOWS) {
        showToast("Limite orario di sicurezza raggiunto (max 30/ora). Riprova più tardi!", "#ff9800");
        return;
      }

      // Pattern Inline Confirm
      if (!unfollowBtn.dataset.confirming) {
        if (activeConfirmingBtn && activeConfirmingBtn !== unfollowBtn) {
          delete activeConfirmingBtn.dataset.confirming;
          activeConfirmingBtn.textContent = "Non seguire";
          activeConfirmingBtn.style.background = "#dc2743";
        }
        unfollowBtn.dataset.confirming = "true";
        unfollowBtn.textContent = "Confermi?";
        unfollowBtn.style.background = "#e65100";
        activeConfirmingBtn = unfollowBtn;
        setTimeout(() => {
          if (unfollowBtn && unfollowBtn.dataset.confirming === "true") {
            delete unfollowBtn.dataset.confirming;
            unfollowBtn.textContent = "Non seguire";
            unfollowBtn.style.background = "#dc2743";
            if (activeConfirmingBtn === unfollowBtn) activeConfirmingBtn = null;
          }
        }, 3000);
        return;
      }

      // Secondo clic confermato: verifica Mutex & Cooldown
      if (unfollowInFlight) {
        showToast("Un'operazione è già in corso. Attendi...", "#ff9800");
        return;
      }

      const now = Date.now();
      if (now < nextAllowedUnfollowAt) {
        const secWait = Math.ceil((nextAllowedUnfollowAt - now) / 1000);
        showToast(`Attendi ancora ${secWait}s per proteggere l'account da blocchi...`, "#ff9800");
        return;
      }

      delete unfollowBtn.dataset.confirming;
      activeConfirmingBtn = null;
      unfollowBtn.disabled = true;
      unfollowBtn.textContent = "Attendere...";

      const id = unfollowBtn.dataset.id;
      const username = unfollowBtn.dataset.username;
      const csrf = getCookie("csrftoken");

      unfollowInFlight = true;

      try {
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

        // Fissa il cooldown deterministico (3.5s - 6s) SEMPRE
        nextAllowedUnfollowAt = Date.now() + 3500 + Math.random() * 2500;

        const data = await res.json().catch(() => null);

        if (res.ok && data?.status === "ok") {
          recordUnfollowAction();
          unfollowBtn.textContent = "Rimosso ✓";
          unfollowBtn.style.background = "#2e7d32";
          showToast(`Hai smesso di seguire @${username}`, "#4caf50");
          allFollowing = allFollowing.filter((u) => u.id !== id);
          setTimeout(computeLists, 600);
        } else {
          if (res.status === 429 || data?.feedback_required) {
            setBlockUntil(Date.now() + 30 * 60 * 1000);
            showToast("Instagram ha rilevato troppe azioni. Unfollow sospesi per 30 minuti.", "#f44336");
          } else {
            showToast(data?.message || "Azione non consentita da Instagram.", "#f44336");
          }
          unfollowBtn.textContent = "Errore";
          unfollowBtn.disabled = false;
        }
      } catch {
        nextAllowedUnfollowAt = Date.now() + 3500 + Math.random() * 2500;
        showToast("Errore di connessione.", "#f44336");
        unfollowBtn.textContent = "Errore";
        unfollowBtn.disabled = false;
      } finally {
        unfollowInFlight = false;
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

  // Ricerca fluida
  let searchTimer;
  document.getElementById("ig-search-input").oninput = (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = e.target.value;
      visibleLimit = 50;
      renderList();
    }, 120);
  };

  // Copia lista sicura
  document.getElementById("ig-copy-btn").onclick = async () => {
    const items = categorized[currentTab] || [];
    if (!items.length) return showToast("Nessun utente nella lista da copiare.");
    const text = items.map((u) => `@${u.username}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Copiati ${items.length} username negli appunti!`, "#4caf50");
    } catch {
      showToast("Accesso agli appunti negato dal browser.", "#f44336");
    }
  };

  // --- AVVIO SCANSIONE CON ATOMIC COMMIT & TOLLERANZA STRETTA ---
  document.getElementById("ig-start-btn").onclick = async () => {
    if (isScanning) return;
    isScanning = true;
    dataTrusted = false; // INVALIDA SUBITO

    const startBtn = document.getElementById("ig-start-btn");
    const statusText = document.getElementById("ig-status-text");
    const progContainer = document.getElementById("ig-progress-container");
    const progBar = document.getElementById("ig-progress-bar");
    const scanState = document.getElementById("ig-scan-state");

    startBtn.disabled = true;
    startBtn.style.opacity = "0.5";
    progContainer.style.display = "block";
    progBar.style.width = "5%";
    scanState.textContent = "Scansione in corso...";

    abortController = new AbortController();
    window.__igTrackerAbort = abortController;
    const signal = abortController.signal;

    try {
      statusText.textContent = "Verifica account e conteggi ufficiali...";
      const { userId, followingCount, followersCount } = await getAccountInfo(signal);

      // Fase 1: Scarica i Seguiti
      const following = await fetchList(
        userId,
        "following",
        (msg, count) => {
          if (!modalContainer.isConnected) return;
          statusText.textContent = `[1/2 Seguiti] ${msg}`;
          if (followingCount > 0) {
            const pct = Math.min(50, Math.round((count / followingCount) * 50));
            progBar.style.width = `${pct}%`;
          }
        },
        signal
      );

      progBar.style.width = "50%";

      // Fase 2: Scarica i Follower
      const followers = await fetchList(
        userId,
        "followers",
        (msg, count) => {
          if (!modalContainer.isConnected) return;
          statusText.textContent = `[2/2 Follower] ${msg}`;
          if (followersCount > 0) {
            const pct = 50 + Math.min(50, Math.round((count / followersCount) * 50));
            progBar.style.width = `${pct}%`;
          }
        },
        signal
      );

      if (!modalContainer.isConnected) return;

      // VALIDAZIONE COMPLETEZZA STRETTA (Massimo 5 account mancanti o 0.5% per disattivazioni naturali)
      const countsKnown = followingCount > 0 && followersCount > 0;
      const maxFollowingTol = Math.min(5, Math.max(1, Math.ceil(followingCount * 0.005)));
      const maxFollowersTol = Math.min(5, Math.max(1, Math.ceil(followersCount * 0.005)));

      const diffFollowing = followingCount - following.length;
      const diffFollowers = followersCount - followers.length;

      const isFollowingOk = countsKnown && diffFollowing <= maxFollowingTol && following.length <= followingCount + 5;
      const isFollowersOk = countsKnown && diffFollowers <= maxFollowersTol && followers.length <= followersCount + 5;
      const isComplete = isFollowingOk && isFollowersOk;

      // ATOMIC COMMIT
      allFollowing = following;
      allFollowers = followers;
      dataTrusted = isComplete;

      const timeStr = new Date().toLocaleTimeString();
      progBar.style.width = "100%";

      if (!countsKnown) {
        statusText.textContent = "Scansione completata (Conteggi profilo non disponibili).";
        scanState.textContent = `Aggiornato alle ${timeStr} (Non verificato - Unfollow disattivati)`;
        showToast("Conteggi profilo non verificabili: unfollow disattivati per sicurezza.", "#ff9800");
      } else if (!isComplete) {
        // Dettaglio esatto delle discrepanze rilevate con spiegazione cache
        const discrepancyParts = [];
        if (!isFollowingOk) discrepancyParts.push(`seguiti: ${following.length}/${followingCount}`);
        if (!isFollowersOk) discrepancyParts.push(`follower: ${followers.length}/${followersCount}`);
        const discrepancyDetail = discrepancyParts.join(", ");

        statusText.textContent = `Discrepanza: ${discrepancyDetail}. (Se hai fatto unfollow di recente, attendi 5 min)`;
        scanState.textContent = `Aggiornato alle ${timeStr} (Dati parziali o cache Instagram in ritardo)`;
        showToast(`Discrepanza (${discrepancyDetail}). Se hai rimosso profili di recente, la cache si aggiornerà a breve.`, "#ff9800");
      } else {
        statusText.textContent = "Scansione completata e verificata con successo!";
        scanState.textContent = `Ultimo aggiornamento verificato: ${timeStr}`;
        showToast("Scansione completata con successo!", "#4caf50");
      }

      computeLists();
    } catch (err) {
      if (err.name === "AbortError") {
        console.log("Scansione annullata.");
      } else {
        console.error(err);
        if (modalContainer.isConnected) {
          statusText.textContent = `Errore: ${err.message}`;
          scanState.textContent = "Scansione fallita (Dati non affidabili - Unfollow disattivati)";
          showToast(err.message, "#f44336");
        }
      }
    } finally {
      isScanning = false;
      if (modalContainer.isConnected) {
        startBtn.disabled = false;
        startBtn.style.opacity = "1";
        startBtn.textContent = "Riscansiona";
      }
    }
  };
})();
