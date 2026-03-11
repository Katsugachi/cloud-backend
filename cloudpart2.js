const express = require("express");
const { randomUUID } = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ── CORS (allow GitHub Pages and any origin to call this backend) ──────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// ════════════════════════════════════════════════════════════════════════════
//  INTERNAL HELPERS
// ════════════════════════════════════════════════════════════════════════════

async function loginWithEmail(email, password) {
  const deviceId   = randomUUID();
  const queryUuid  = randomUUID();

  const loginUrl = new URL("https://api.prod.cloudmoonapp.com/login/pwd");
  loginUrl.searchParams.set("device_type", "web");
  loginUrl.searchParams.set("query_uuid",  queryUuid);
  loginUrl.searchParams.set("device_id",   deviceId);
  loginUrl.searchParams.set("site",        "cm");

  const response = await fetch(loginUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "X-User-Language": "en",
      "X-User-Locale":   "US"
    },
    body: JSON.stringify({ email, password })
  });

  const json = await response.json();
  if (!response.ok || json.code !== 0) {
    throw new Error(`Email login failed: ${JSON.stringify(json)}`);
  }

  return { token: json.data.token, user_id: json.data.user_id, deviceId };
}

async function loginWithGoogleIdToken(googleIdToken) {
  const deviceId  = randomUUID();
  const queryUuid = randomUUID();

  const loginUrl = new URL("https://api.prod.cloudmoonapp.com/login/google");
  loginUrl.searchParams.set("device_type", "web");
  loginUrl.searchParams.set("query_uuid",  queryUuid);
  loginUrl.searchParams.set("device_id",   deviceId);
  loginUrl.searchParams.set("site",        "cm");

  const response = await fetch(loginUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "X-User-Language": "en",
      "X-User-Locale":   "US"
    },
    body: JSON.stringify({ google_id_token: googleIdToken })
  });

  const json = await response.json();
  if (!response.ok || json.code !== 0) {
    throw new Error(`Google login failed: ${JSON.stringify(json)}`);
  }

  return { token: json.data.token, user_id: json.data.user_id, deviceId };
}

// ════════════════════════════════════════════════════════════════════════════
//  GET /auth/token?token=<cloudmoon_token>
//  Token-paste flow: user pastes their 30-day CloudMoon token from
//  web.cloudmoonapp.com console. We validate it, fetch user info + android_id.
// ════════════════════════════════════════════════════════════════════════════
app.get("/auth/token", async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ error: "Missing token parameter" });
  }

  try {
    const deviceId = randomUUID();
    const headers  = {
      "X-User-Token":    token,
      "X-User-Language": "en",
      "X-User-Locale":   "US"
    };

    // Fetch user info
    const uiUrl = new URL("https://api.prod.cloudmoonapp.com/user/info");
    uiUrl.searchParams.set("device_type", "web");
    uiUrl.searchParams.set("query_uuid",  randomUUID());
    uiUrl.searchParams.set("device_id",   deviceId);
    uiUrl.searchParams.set("site",        "cm");

    const uiRes  = await fetch(uiUrl.toString(), { headers });
    const uiJson = await uiRes.json();

    if (uiJson.code !== 0) {
      throw new Error(`Token invalid or expired: ${JSON.stringify(uiJson)}`);
    }

    // Fetch phone list (to get android_id)
    const plUrl = new URL("https://api.prod.cloudmoonapp.com/phone/list");
    plUrl.searchParams.set("device_type", "web");
    plUrl.searchParams.set("query_uuid",  randomUUID());
    plUrl.searchParams.set("device_id",   deviceId);
    plUrl.searchParams.set("site",        "cm");

    const plRes  = await fetch(plUrl.toString(), { headers });
    const plJson = await plRes.json();

    const android_id =
      plJson?.data?.list?.[0]?.android_id || "1951154706843701248";

    res.json({
      user_id:    uiJson?.data?.user_id,
      name:       uiJson?.data?.name,
      email:      uiJson?.data?.email,
      picture:    uiJson?.data?.avatar,
      android_id
    });
  } catch (err) {
    console.error("[/auth/token]", err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  GET /auth/exchange?id_token=<google_id_token>
//  Exchange a Google ID token for a CloudMoon token (original flow).
// ════════════════════════════════════════════════════════════════════════════
app.get("/auth/exchange", async (req, res) => {
  const { id_token } = req.query;
  if (!id_token) {
    return res.status(400).json({ error: "Missing id_token parameter" });
  }

  try {
    const auth = await loginWithGoogleIdToken(id_token);
    res.json(auth);
  } catch (err) {
    console.error("[/auth/exchange]", err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  GET /user-info  (original endpoint — kept intact)
// ════════════════════════════════════════════════════════════════════════════
app.get("/user-info", async (req, res) => {
  const {
    email,
    password,
    gid,
    game    = "com.roblox.client",
    res: screenRes = "720x1280"
  } = req.query;

  if ((!email || !password) && !gid) {
    return res.status(400).json({
      error: "Missing credentials",
      usage: {
        email_login:  "/user-info?email=user@example.com&password=12345",
        google_login: "/user-info?gid=GOOGLE_ID_TOKEN"
      }
    });
  }

  try {
    const auth = gid
      ? await loginWithGoogleIdToken(gid)
      : await loginWithEmail(email, password);

    const { token, user_id, deviceId } = auth;

    const userInfoUrl = new URL("https://api.prod.cloudmoonapp.com/user/info");
    userInfoUrl.searchParams.set("device_type", "web");
    userInfoUrl.searchParams.set("query_uuid",  randomUUID());
    userInfoUrl.searchParams.set("device_id",   deviceId);
    userInfoUrl.searchParams.set("site",        "cm");

    const userInfoResponse = await fetch(userInfoUrl.toString(), {
      headers: {
        "X-User-Token":    token,
        "X-User-Language": "en",
        "X-User-Locale":   "US"
      }
    });
    const userInfo = await userInfoResponse.json();

    const phoneListUrl = new URL("https://api.prod.cloudmoonapp.com/phone/list");
    phoneListUrl.searchParams.set("device_type", "web");
    phoneListUrl.searchParams.set("query_uuid",  randomUUID());
    phoneListUrl.searchParams.set("device_id",   deviceId);
    phoneListUrl.searchParams.set("site",        "cm");

    const phoneListResponse = await fetch(phoneListUrl.toString(), {
      headers: {
        "X-User-Token":    token,
        "X-User-Language": "en",
        "X-User-Locale":   "US"
      }
    });
    const phoneList = await phoneListResponse.json();

    const phoneConnectUrl = new URL("https://api.prod.cloudmoonapp.com/phone/connect");
    phoneConnectUrl.searchParams.set("device_type", "web");
    phoneConnectUrl.searchParams.set("query_uuid",  randomUUID());
    phoneConnectUrl.searchParams.set("device_id",   deviceId);
    phoneConnectUrl.searchParams.set("game_name",   game);
    phoneConnectUrl.searchParams.set("screen_res",  screenRes);
    phoneConnectUrl.searchParams.set("site",        "cm");

    const phoneConnectResponse = await fetch(phoneConnectUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "X-User-Token":    token,
        "X-User-Language": "en",
        "X-User-Locale":   "US"
      },
      body: JSON.stringify({
        android_id: "1951154706843701248",
        server_id:  22,
        params: JSON.stringify({ language: "en", locale: "us" })
      })
    });
    const phoneConnect = await phoneConnectResponse.json();

    res.json({
      login_method:  gid ? "google" : "email",
      user_id,
      token,
      device_id:     deviceId,
      user_info:     userInfo,
      phone_list:    phoneList,
      phone_connect: phoneConnect
    });
  } catch (err) {
    console.error("[/user-info]", err);
    res.status(500).json({ error: err.message });
  }
});

// ── START ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Solus MS cloud backend running at http://localhost:${PORT}`);
});
