(async () => {
  // Rimuovi eventuale istanza precedente
  const oldModal = document.getElementById("ig-tracker-modal");
  if (oldModal) oldModal.remove();

  const getCookie = (name) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(";").shift();
    return null;
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 1. Recupero User ID sicuro
  const getMyUserId = async () => {
    let id = getCookie("ds_user_id");
    if (id) return id;

    try {
      if (window._sharedData?.config?.viewerId) return window._sharedData.config.viewerId;
    } catch (e) {}

    try {
      const res = await fetch("https://www.instagram.com/accounts/edit/?__a=1&__d=dis", {
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.form_data?.id) return String(json.form_data.id);
      }
    } catch (e) {}

    const html = await (await fetch("https://www.instagram.com/", { credentials: "include" })).text();
    const match = html.match(/"viewerId":"(\d+)"/) || html.match(/"id":"(\d+)","username"/);
    if (match) return match[1];

    throw new Error("Impossibile recuperare lo User ID. Assicurati di essere loggato su instagram.com!");
  };

  // 2. Creazione Interfaccia Grafica
  const modalContainer = document.createElement("div");
  modalContainer.id = "ig-tracker-modal";
  modalContainer.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0, 0, 0, 0.78); backdrop-filter: blur(6px);
    z-index: 9999999; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #fff; padding: 20px; box-sizing: border-box;
  `;

  modalContainer.innerHTML = `
    <div style="background: #181818; width: 100%; max-width: 680px; height: 85vh; border-radius: 14px; border: 1px solid #333; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.8);">
      <!-- Header -->
      <div style="padding: 16px 20px; border-bottom: 1px solid #282828; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="background: linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888); width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">IG</div>
          <h2 style="margin: 0; font-size: 18px; font-weight: 600;">Instagram Relationship Tracker</h2>
        </div>
        <button id="ig-close-btn" style="background: transparent; border: none; color: #888; font-size: 24px; cursor: pointer; padding: 4px;">&times;</button>
      </div>

      <!-- Barra di Stato -->
      <div id="ig-status-bar" style="padding: 12px 20px; background: #222; font-size: 13px; color: #bbb; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #282828;">
        <span id="ig-status-text">Pronto per iniziare.</span>
        <button id="ig-start-btn" style="background: #0095f6; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;">Avvia Scansione</button>
      </div>

      <!-- Barra di Progresso -->
      <div id="ig-progress-container" style="display: none; height: 4px; background: #262626; width: 100%;">
        <div id="ig-progress-bar" style="width: 0%; height: 100%; background: #0095f6; transition: width 0.3s ease;"></div>
      </div>

      <!-- Tab e Ricerca -->
      <div style="padding: 12px 20px; display: flex; flex-direction: column; gap: 10px; border-bottom: 1px solid #282828;">
        <div style="display: flex; gap: 8px; overflow-x: auto;">
          <button class="ig-tab active" data-tab="notFollowingBack" style="background: #333; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer;">Non ricambiano (<span id="count-notFollowingBack">0</span>)</button>
          <button class="ig-tab" data-tab="fans" style="background: transparent; color: #888; border: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer;">Fan (<span id="count-fans">0</span>)</button>
          <button class="ig-tab" data-tab="mutual" style="background: transparent; color: #888; border: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer;">Reciproci (<span id="count-mutual">0</span>)</button>
          <button class="ig-tab" data-tab="whitelist" style="background: transparent; color: #888; border: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; cursor: pointer;">Whitelist (<span id="count-whitelist">0</span>)</button>
        </div>
        <div style="display: flex; gap: 10px;">
          <input type="text" id="ig-search-input" placeholder="Cerca username o nome..." style="flex: 1; background: #262626; border: 1px solid #363636; border-radius: 6px; padding: 8px 12px; color: #fff; font-size: 13px; outline: none;">
          <button id="ig-copy-btn" title="Copia lista" style="background: #2b2b2b; color: #fff; border: 1px solid #3a3a3a; padding: 8px 14px; border-radius: 6px; font-size: 13px; cursor: pointer;">📋 Copia</button>
          <button id="ig-export-btn" title="Esporta file TXT" style="background: #2b2b2b; color: #fff; border: 1px solid #3a3a3a; padding: 8px 14px; border-radius: 6px; font-size: 13px; cursor: pointer;">💾 Salva TXT</button>
        </div>
      </div>

      <!-- Lista Risultati -->
      <div id="ig-users-list" style="flex: 1; overflow-y: auto; padding: 8px 20px; display: flex; flex-direction: column; gap: 6px;">
        <div style="text-align: center; color: #777; margin-top: 40px; font-size: 14px;">Clicca su "Avvia Scansione" per caricare follower e seguiti.</div>
      </div>

      <!-- Footer -->
      <div style="padding: 10px 20px; background: #141414; border-top: 1px solid #222; font-size: 11px; color: #777; display: flex; justify-content: space-between; align-items: center;">
        <span>Delay anti-blocco attivo (~1.5s tra pagine)</span>
        <span>Seguiti: <b id="total-following">0</b> | Follower: <b id="total-followers">0</b></span>
      </div>
    </div>
  `;

  document.body.appendChild(modalContainer);
  document.getElementById("ig-close-btn").onclick = () => modalContainer.remove();

  // Stato applicativo
  let allFollowing = [];
  let allFollowers = [];
  let categorized = { notFollowingBack: [], fans: [], mutual: [], whitelist: [] };
  let currentTab = "notFollowingBack";
  let searchQuery = "";
  let isScanning = false;

  const getStoredWhitelist = () => {
    try {
      return JSON.parse(localStorage.getItem("ig_tracker_whitelist") || "[]");
    } catch (e) {
      return [];
    }
  };

  const saveStoredWhitelist = (list) => {
    localStorage.setItem("ig_tracker_whitelist", JSON.stringify(list));
  };

  const fetchFriendships = async (userId, type, onProgress) => {
    const list = [];
    let maxId = null;
    let hasMore = true;

    const baseHeaders = {
      "x-ig-app-id": "936619743392459",
      "x-asbd-id": "129477",
      "x-requested-with": "XMLHttpRequest",
    };
    const csrf = getCookie("csrftoken");
    if (csrf) baseHeaders["x-csrftoken"] = csrf;

    while (hasMore) {
      let url = `https://www.instagram.com/api/v1/friendships/${userId}/${type}/?count=50`;
      if (type === "followers") url += "&search_surface=follow_list_page";
      if (maxId) url += `&max_id=${encodeURIComponent(maxId)}`;

      let res;
      let retries = 0;
      while (retries < 3) {
        try {
          res = await fetch(url, { headers: baseHeaders, credentials: "include" });
          if (res.status === 429) {
            onProgress(`Rate-limit rilevato. Pausa di sicurezza di 15 secondi...`, list.length);
            await sleep(15000);
            retries++;
            continue;
          }
          if (res.ok) break;
        } catch (err) {
          retries++;
          await sleep(3000);
        }
      }

      if (!res || !res.ok) {
        console.error(`Errore nel caricamento di ${type}`);
        break;
      }

      const data = await res.json();
      if (Array.isArray(data.users)) {
        for (const u of data.users) {
          list.push({
            id: String(u.pk || u.id),
            username: u.username,
            full_name: u.full_name || "",
            profile_pic_url: u.profile_pic_url || "",
            is_private: Boolean(u.is_private),
            is_verified: Boolean(u.is_verified),
          });
        }
      }

      maxId = data.next_max_id;
      hasMore = Boolean(maxId);

      onProgress(`Scaricati ${list.length} ${type}...`, list.length);
      await sleep(1000 + Math.random() * 800);
    }

    return list;
  };

  const computeLists = () => {
    const whitelistUsernames = new Set(getStoredWhitelist().map((u) => u.toLowerCase()));
    const followerSet = new Set(allFollowers.map((u) => u.username.toLowerCase()));
    const followingSet = new Set(allFollowing.map((u) => u.username.toLowerCase()));

    categorized.whitelist = allFollowing.filter((u) => whitelistUsernames.has(u.username.toLowerCase()));
    categorized.notFollowingBack = allFollowing.filter(
      (u) => !followerSet.has(u.username.toLowerCase()) && !whitelistUsernames.has(u.username.toLowerCase())
    );
    categorized.fans = allFollowers.filter((u) => !followingSet.has(u.username.toLowerCase()));
    categorized.mutual = allFollowing.filter((u) => followerSet.has(u.username.toLowerCase()));

    document.getElementById("count-notFollowingBack").innerText = categorized.notFollowingBack.length;
    document.getElementById("count-fans").innerText = categorized.fans.length;
    document.getElementById("count-mutual").innerText = categorized.mutual.length;
    document.getElementById("count-whitelist").innerText = categorized.whitelist.length;
    document.getElementById("total-following").innerText = allFollowing.length;
    document.getElementById("total-followers").innerText = allFollowers.length;

    renderList();
  };

  const renderList = () => {
    const listEl = document.getElementById("ig-users-list");
    let items = categorized[currentTab] || [];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((u) => u.username.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q));
    }

    if (items.length === 0) {
      listEl.innerHTML = `<div style="text-align: center; color: #777; margin-top: 30px; font-size: 13px;">Nessun utente trovato in questa sezione.</div>`;
      return;
    }

    const whitelist = new Set(getStoredWhitelist().map((u) => u.toLowerCase()));

    listEl.innerHTML = items
      .map((user) => {
        const isWhitelisted = whitelist.has(user.username.toLowerCase());
        return `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #202020; border-radius: 8px; border: 1px solid #2c2c2c;">
          <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
            <img src="${user.profile_pic_url}" onerror="this.src='https://static.cdninstagram.com/rsrc.php/v3/y6/r/_j_hL6y04g0.png'" style="width: 42px; height: 42px; border-radius: 50%; object-fit: cover; border: 1px solid #333;" alt="" />
            <div style="overflow: hidden;">
              <div style="display: flex; align-items: center; gap: 4px;">
                <a href="https://www.instagram.com/${user.username}/" target="_blank" style="color: #fff; font-weight: 600; text-decoration: none; font-size: 13px;">${user.username}</a>
                ${user.is_verified ? '<span style="color: #0095f6; font-size: 12px;">✓</span>' : ""}
                ${user.is_private ? '<span style="color: #888; font-size: 10px; border: 1px solid #444; border-radius: 4px; padding: 1px 3px;">Privato</span>' : ""}
              </div>
              <div style="font-size: 12px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">${user.full_name}</div>
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button class="toggle-whitelist-btn" data-username="${user.username}" title="${isWhitelisted ? "Rimuovi da Whitelist" : "Aggiungi a Whitelist"}" style="background: ${isWhitelisted ? "#ffc107" : "#333"}; color: ${isWhitelisted ? "#000" : "#bbb"}; border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px;">★</button>
            <button class="unfollow-btn" data-id="${user.id}" data-username="${user.username}" style="background: #e53935; color: #fff; border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; font-weight: 500;">Smetti di seguire</button>
          </div>
        </div>
      `;
      })
      .join("");

    listEl.querySelectorAll(".toggle-whitelist-btn").forEach((btn) => {
      btn.onclick = () => {
        const uname = btn.dataset.username.toLowerCase();
        let currentWl = getStoredWhitelist();
        if (currentWl.map((u) => u.toLowerCase()).includes(uname)) {
          currentWl = currentWl.filter((u) => u.toLowerCase() !== uname);
        } else {
          currentWl.push(btn.dataset.username);
        }
        saveStoredWhitelist(currentWl);
        computeLists();
      };
    });

    listEl.querySelectorAll(".unfollow-btn").forEach((btn) => {
      btn.onclick = async () => {
        const uid = btn.dataset.id;
        const uname = btn.dataset.username;
        if (!confirm(`Vuoi davvero smettere di seguire @${uname}?`)) return;

        btn.disabled = true;
        btn.innerText = "Rimozione...";

        const csrf = getCookie("csrftoken");
        try {
          const resp = await fetch(`https://www.instagram.com/api/v1/friendships/destroy/${uid}/`, {
            method: "POST",
            headers: {
              "x-csrftoken": csrf || "",
              "x-ig-app-id": "936619743392459",
              "content-type": "application/x-www-form-urlencoded",
            },
            credentials: "include",
          });
          if (resp.ok) {
            btn.innerText = "Rimosso ✓";
            btn.style.background = "#4caf50";
            allFollowing = allFollowing.filter((u) => u.username.toLowerCase() !== uname.toLowerCase());
            setTimeout(computeLists, 800);
          } else {
            alert("Errore nell'unfollow. Azione limitata temporaneamente.");
            btn.innerText = "Errore";
          }
        } catch (e) {
          alert("Errore di rete.");
          btn.innerText = "Errore";
        }
      };
    });
  };

  document.querySelectorAll(".ig-tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll(".ig-tab").forEach((t) => {
        t.style.background = "transparent";
        t.style.color = "#888";
      });
      tab.style.background = "#333";
      tab.style.color = "#fff";
      currentTab = tab.dataset.tab;
      renderList();
    };
  });

  document.getElementById("ig-search-input").oninput = (e) => {
    searchQuery = e.target.value;
    renderList();
  };

  document.getElementById("ig-copy-btn").onclick = async () => {
    const items = categorized[currentTab] || [];
    if (!items.length) return alert("Nessun utente nella categoria corrente.");
    const text = items.map((u) => `@${u.username}`).join("\n");
    await navigator.clipboard.writeText(text);
    alert(`Copiati ${items.length} username negli appunti!`);
  };

  document.getElementById("ig-export-btn").onclick = () => {
    const items = categorized[currentTab] || [];
    if (!items.length) return alert("Nessun utente da esportare.");
    const content = items.map((u) => `${u.username} (${u.full_name || "N/A"})`).join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `instagram_${currentTab}_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById("ig-start-btn").onclick = async () => {
    if (isScanning) return;
    isScanning = true;

    const startBtn = document.getElementById("ig-start-btn");
    const statusText = document.getElementById("ig-status-text");
    const progContainer = document.getElementById("ig-progress-container");
    const progBar = document.getElementById("ig-progress-bar");

    startBtn.disabled = true;
    startBtn.style.opacity = "0.5";
    progContainer.style.display = "block";

    try {
      statusText.innerText = "Ricerca User ID...";
      const myId = await getMyUserId();

      progBar.style.width = "25%";
      statusText.innerText = "Caricamento delle persone che segui...";
      allFollowing = await fetchFriendships(myId, "following", (msg) => {
        statusText.innerText = msg;
      });

      progBar.style.width = "75%";
      statusText.innerText = "Caricamento dei tuoi follower...";
      allFollowers = await fetchFriendships(myId, "followers", (msg) => {
        statusText.innerText = msg;
      });

      progBar.style.width = "100%";
      statusText.innerText = "Scansione terminata con successo!";
      computeLists();
    } catch (err) {
      console.error(err);
      statusText.innerText = `Errore: ${err.message}`;
    } finally {
      isScanning = false;
      startBtn.disabled = false;
      startBtn.style.opacity = "1";
      startBtn.innerText = "Riscansiona";
    }
  };
})();
