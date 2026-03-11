const express = require("express");
const { randomUUID } = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// ════════════════════════════════════════════════════════════════════════════
//  SHARED HELPERS
// ════════════════════════════════════════════════════════════════════════════

function cmHeaders(token) {
  return {
    "X-User-Token":    token,
    "X-User-Language": "en",
    "X-User-Locale":   "US"
  };
}

function cmUrl(path, extra = {}) {
  const u = new URL("https://api.prod.cloudmoonapp.com" + path);
  u.searchParams.set("device_type", "web");
  u.searchParams.set("query_uuid",  randomUUID());
  u.searchParams.set("device_id",   randomUUID());
  u.searchParams.set("site",        "cm");
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

function b64url(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ════════════════════════════════════════════════════════════════════════════
//  GET /auth/token?token=<cloudmoon_token>
//  Validate token, return user info + android_id
// ════════════════════════════════════════════════════════════════════════════
app.get("/auth/token", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Missing token" });

  try {
    const headers = cmHeaders(token);

    const uiRes  = await fetch(cmUrl("/user/info"), { headers });
    const uiJson = await uiRes.json();
    if (uiJson.code !== 0) throw new Error("Token invalid: " + JSON.stringify(uiJson));

    const plRes  = await fetch(cmUrl("/phone/list"), { headers });
    const plJson = await plRes.json();

    const android_id = plJson?.data?.list?.[0]?.android_id || "1951154706843701248";

    // uiJson.data.user_id is the numeric account ID (e.g. 4534412071)
    // android_id from phone/list is the device ID (the big number)
    const accountUserId = uiJson?.data?.user_id || uiJson?.data?.userId;
    console.log("[/auth/token] user_id:", accountUserId, "android_id:", android_id);
    res.json({
      user_id:    accountUserId,
      name:       uiJson?.data?.name,
      email:      uiJson?.data?.email,
      picture:    uiJson?.data?.avatar,
      android_id
    });
  } catch (err) {
    console.error("[/auth/token]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  GET /launch?token=&android_id=&user_id=&game=&quality=
//
//  Calls phone/connect to spin up the Android VM, gets the real IP,
//  builds the android_instance_id, and returns the full run-site URL.
//
//  This is the KEY fix — without phone/connect the coordinator has
//  no free instance and returns errorCode 1 ("Server is busy").
// ════════════════════════════════════════════════════════════════════════════
app.get("/launch", async (req, res) => {
  const { token, android_id, user_id, game, quality = "SD" } = req.query;
  if (!token || !android_id || !user_id || !game) {
    return res.status(400).json({ error: "Missing required params: token, android_id, user_id, game" });
  }

  try {
    const headers = { ...cmHeaders(token), "Content-Type": "application/json" };

    // Step 1: phone/list to get correct server_id for this user
    const plRes  = await fetch(cmUrl("/phone/list"), { headers: cmHeaders(token) });
    const plJson = await plRes.json();
    console.log("[/launch] phone/list:", JSON.stringify(plJson).slice(0, 500));

    const phoneEntry    = plJson?.data?.list?.[0];
    const serverId      = phoneEntry?.server_id ?? 22;
    const poolAndroidId = phoneEntry?.android_id ?? "1951154706843701248";

    // Step 2: phone/connect with correct server_id
    const pcRes = await fetch(cmUrl("/phone/connect", { game_name: game, screen_res: "720x1280" }), {
      method: "POST",
      headers,
      body: JSON.stringify({
        android_id: poolAndroidId,
        server_id:  serverId,
        params: JSON.stringify({ language: "en", locale: "us" })
      })
    });
    const pcJson = await pcRes.json();
    console.log("[/launch] phone/connect:", JSON.stringify(pcJson).slice(0, 800));

    const coorUrl   = pcJson?.data?.coor_url    || "https://coor-la.prod.cloudmoonapp.com";
    const androidIp = pcJson?.data?.android_ip  || pcJson?.data?.ip || "127.0.0.1";

    const androidInstanceId = b64url(JSON.stringify({
      userId:      user_id,
      androidName: "SolusMSDevice",
      androidIp:   androidIp,
      svc:         "",
      coorUrl:     coorUrl
    }));

    const RUN_SITE = "https://katsugachi.github.io/Experiment-Solus-MS/run-site/index.html";
    const url = RUN_SITE
      + "?userid="              + encodeURIComponent(android_id)
      + "&game="                + encodeURIComponent(game)
      + "&android_instance_id=" + encodeURIComponent(androidInstanceId)
      + "&coor_url="            + encodeURIComponent(coorUrl)
      + "&uuid="                + encodeURIComponent(user_id)
      + "&quality="             + quality
      + "&token="               + encodeURIComponent(token);

    // Return full debug info so we can see exactly what CloudMoon returned
    res.json({
      url,
      debug: { androidIp, coorUrl, serverId, poolAndroidId, androidInstanceId, phoneConnectRaw: pcJson, phoneListRaw: plJson }
    });
  } catch (err) {
    console.error("[/launch]", err.message);
    res.status(500).json({ error: err.message });
  }}););

// ════════════════════════════════════════════════════════════════════════════
//  GET /auth/exchange?id_token=<google_id_token>  (kept for compat)
// ════════════════════════════════════════════════════════════════════════════
app.get("/auth/exchange", async (req, res) => {
  const { id_token } = req.query;
  if (!id_token) return res.status(400).json({ error: "Missing id_token" });
  try {
    const u = new URL("https://api.prod.cloudmoonapp.com/login/google");
    u.searchParams.set("device_type", "web");
    u.searchParams.set("query_uuid",  randomUUID());
    u.searchParams.set("device_id",   randomUUID());
    u.searchParams.set("site",        "cm");
    const r = await fetch(u.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Language": "en", "X-User-Locale": "US" },
      body: JSON.stringify({ google_id_token: id_token })
    });
    const j = await r.json();
    if (!r.ok || j.code !== 0) throw new Error(JSON.stringify(j));
    res.json({ token: j.data.token, user_id: j.data.user_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  GET /user-info  (original endpoint — kept intact)
// ════════════════════════════════════════════════════════════════════════════
app.get("/user-info", async (req, res) => {
  const { email, password, gid, game = "com.roblox.client", res: screenRes = "720x1280" } = req.query;
  if ((!email || !password) && !gid) {
    return res.status(400).json({ error: "Missing credentials" });
  }
  try {
    let token, user_id;
    if (gid) {
      const u = cmUrl("/login/google");
      const r = await fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Language": "en", "X-User-Locale": "US" },
        body: JSON.stringify({ google_id_token: gid })
      });
      const j = await r.json();
      if (j.code !== 0) throw new Error(JSON.stringify(j));
      token = j.data.token; user_id = j.data.user_id;
    } else {
      const u = cmUrl("/login/pwd");
      const r = await fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Language": "en", "X-User-Locale": "US" },
        body: JSON.stringify({ email, password })
      });
      const j = await r.json();
      if (j.code !== 0) throw new Error(JSON.stringify(j));
      token = j.data.token; user_id = j.data.user_id;
    }
    const headers = cmHeaders(token);
    const [uiRes, plRes, pcRes] = await Promise.all([
      fetch(cmUrl("/user/info"),                                                { headers }),
      fetch(cmUrl("/phone/list"),                                               { headers }),
      fetch(cmUrl("/phone/connect", { game_name: game, screen_res: screenRes }), {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ android_id: "1951154706843701248", server_id: 22, params: JSON.stringify({ language: "en", locale: "us" }) })
      })
    ]);
    res.json({
      user_id, token,
      user_info:     await uiRes.json(),
      phone_list:    await plRes.json(),
      phone_connect: await pcRes.json()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Solus MS cloud backend running on port ${PORT}`));
