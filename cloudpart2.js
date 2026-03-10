const express = require("express");
const { randomUUID } = require("crypto");

const app = express();
const PORT = 3000;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

async function loginWithEmail(email, password) {
  const deviceId = randomUUID();
  const queryUuid = randomUUID();

  const loginUrl = new URL("https://api.prod.cloudmoonapp.com/login/pwd");
  loginUrl.searchParams.set("device_type", "web");
  loginUrl.searchParams.set("query_uuid", queryUuid);
  loginUrl.searchParams.set("device_id", deviceId);

  const response = await fetch(loginUrl.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Language": "en",
      "X-User-Locale": "US"
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
  const deviceId = randomUUID();
  const queryUuid = randomUUID();

  const loginUrl = new URL("https://api.prod.cloudmoonapp.com/login/google");
  loginUrl.searchParams.set("device_type", "web");
  loginUrl.searchParams.set("query_uuid", queryUuid);
  loginUrl.searchParams.set("device_id", deviceId);

  // Try every field name CloudMoon might accept
  const bodies = [
    { google_id_token: googleIdToken },
    { id_token: googleIdToken },
    { token: googleIdToken },
    { access_token: googleIdToken },
    { credential: googleIdToken },
  ];

  let lastError = null;
  for (const body of bodies) {
    const response = await fetch(loginUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Language": "en",
        "X-User-Locale": "US",
        "Origin": "https://web.cloudmoonapp.com",
        "Referer": "https://web.cloudmoonapp.com/"
      },
      body: JSON.stringify(body)
    });

    const json = await response.json();
    console.log("Tried:", JSON.stringify(body).slice(0, 40), "->", JSON.stringify(json));

    if (json.code === 0) {
      return { token: json.data.token, user_id: json.data.user_id, deviceId };
    }
    lastError = json;
  }

  throw new Error(`Google login failed all attempts. Last: ${JSON.stringify(lastError)}`);
}

app.get("/user-info", async (req, res) => {
  const {
    email,
    password,
    gid,
    game = "com.roblox.client",
    res: screenRes = "720x1280"
  } = req.query;

  if ((!email || !password) && !gid) {
    return res.status(400).json({ error: "Missing credentials" });
  }

  try {
    const auth = gid
      ? await loginWithGoogleIdToken(gid)
      : await loginWithEmail(email, password);

    const { token, user_id, deviceId } = auth;

    const userInfoUrl = new URL("https://api.prod.cloudmoonapp.com/user/info");
    userInfoUrl.searchParams.set("device_type", "web");
    userInfoUrl.searchParams.set("query_uuid", randomUUID());
    userInfoUrl.searchParams.set("device_id", deviceId);

    const userInfoResponse = await fetch(userInfoUrl.toString(), {
      headers: { "X-User-Token": token, "X-User-Language": "en", "X-User-Locale": "US" }
    });
    const userInfo = await userInfoResponse.json();

    const phoneListUrl = new URL("https://api.prod.cloudmoonapp.com/phone/list");
    phoneListUrl.searchParams.set("device_type", "web");
    phoneListUrl.searchParams.set("query_uuid", randomUUID());
    phoneListUrl.searchParams.set("device_id", deviceId);

    const phoneListResponse = await fetch(phoneListUrl.toString(), {
      headers: { "X-User-Token": token, "X-User-Language": "en", "X-User-Locale": "US" }
    });
    const phoneList = await phoneListResponse.json();

    const phoneConnectUrl = new URL("https://api.prod.cloudmoonapp.com/phone/connect");
    phoneConnectUrl.searchParams.set("device_type", "web");
    phoneConnectUrl.searchParams.set("query_uuid", randomUUID());
    phoneConnectUrl.searchParams.set("device_id", deviceId);
    phoneConnectUrl.searchParams.set("game_name", game);
    phoneConnectUrl.searchParams.set("screen_res", screenRes);

    const phoneConnectResponse = await fetch(phoneConnectUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Token": token,
        "X-User-Language": "en",
        "X-User-Locale": "US"
      },
      body: JSON.stringify({
        android_id: "1951154706843701248",
        server_id: 22,
        params: JSON.stringify({ language: "en", locale: "us" })
      })
    });
    const phoneConnect = await phoneConnectResponse.json();

    res.json({
      login_method: gid ? "google" : "email",
      user_id,
      token,
      device_id: deviceId,
      user_info: userInfo,
      phone_list: phoneList,
      phone_connect: phoneConnect
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`its at http://localhost:${PORT}`));
