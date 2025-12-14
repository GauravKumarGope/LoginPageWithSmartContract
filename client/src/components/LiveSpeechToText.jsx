import React, { useEffect, useRef, useState } from "react";

/**
 * LiveSpeechToText
 * - Spacebar toggles listening
 * - Connects to ws://localhost:5000/ws
 * - Sends interim transcripts as { type: "transcript", text: "...", lang: "auto" }
 * - Shows original interim text and English translation from server
 * - Auto-switches recognition.lang when server detects language with good confidence
 *
 * Notes:
 * - Works best in Chrome (Web Speech API)
 * - Tweak WS_URL and CONF_THRESHOLD as needed
 */

export default function LiveSpeechToText() {
  const WS_URL = "ws://localhost:5000/ws";
  const SEND_THROTTLE_MS = 200; // minimal gap between sends
  const CONF_THRESHOLD = 0.7; // restart recognition if server reports confidence >= this

  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [translation, setTranslation] = useState("");
  const [detectedLang, setDetectedLang] = useState(null);
  const [lastServerMsg, setLastServerMsg] = useState(null);

  const wsRef = useRef(null);
  const recogRef = useRef(null);
  const lastSendRef = useRef(0);

  // open websocket once on mount
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WS connected");
      setConnected(true);
    };

    ws.onmessage = (ev) => {
      // log raw message for debugging
      console.log("WS recv raw:", ev.data);
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        console.warn("WS message parse failed", e);
        return;
      }
      setLastServerMsg(msg);

      // Defensive handling: accept several shapes
      // Prefer canonical: { type: "translation", text, srcLang, confidence }
      if (msg.type === "translation") {
        setTranslation(msg.text || msg.translatedText || "");
        if (msg.srcLang) setDetectedLang(msg.srcLang);
        // auto restart recognizer if confidence is high
        if (msg.srcLang && typeof msg.confidence === "number" && msg.confidence >= CONF_THRESHOLD) {
          // restart recognition in background (no UI flicker ideally)
          restartRecognitionWithLang(msg.srcLang);
        }
      } else if (msg.translatedText && !msg.type) {
        // fallback: some servers return translatedText root
        setTranslation(msg.translatedText);
      } else if (msg.type === "raw_transcript") {
        setInterim(msg.text || "");
      } else if (msg.type === "error") {
        console.warn("Server error:", msg);
      } else {
        // unknown shape - try to be helpful
        if (msg.text && typeof msg.text === "string") setTranslation(msg.text);
      }
    };

    ws.onclose = () => {
      console.log("WS closed");
      setConnected(false);
    };

    ws.onerror = (err) => {
      console.warn("WS error", err);
    };

    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      wsRef.current = null;
    };
  }, []);

  // Spacebar global toggle (ignore when typing in inputs)
  useEffect(() => {
    function onKeyDown(e) {
      const active = document.activeElement;
      const activeIsInput = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
      if (activeIsInput) return;
      if (e.code === "Space") {
        e.preventDefault();
        toggleListening();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [listening]);

  // throttled send transcript
  function sendTranscript(text) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - lastSendRef.current < SEND_THROTTLE_MS) return;
    lastSendRef.current = now;
    const msg = { type: "transcript", text, lang: "auto" };
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {
      console.warn("Failed to send transcript", e);
    }
  }

  // start recognizer with a given BCP-47 language tag
  function startRecognitionWithLang(langTag = navigator.language || "en-US") {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Web Speech API not supported in this browser. Use Chrome.");
      return false;
    }

    // stop existing to ensure fresh start
    if (recogRef.current) {
      try {
        recogRef.current.onresult = null;
        recogRef.current.onend = null;
        recogRef.current.onerror = null;
        recogRef.current.stop();
      } catch (e) {
        // ignore
      }
      recogRef.current = null;
    }

    const recog = new SpeechRecognition();
    recog.interimResults = true;
    recog.continuous = true;
    recog.maxAlternatives = 1;
    recog.lang = langTag;

    recog.onresult = (event) => {
      let interimText = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      const toShow = interimText || finalText;
      setInterim(toShow);
      if (toShow.trim()) {
        sendTranscript(toShow);
      }
    };

    recog.onerror = (e) => {
      console.warn("Speech recognition error", e);
    };

    recog.onend = () => {
      // If we expected to keep listening, attempt a restart (helps some browser quirks)
      if (recogRef.current) {
        try {
          recog.start();
        } catch (e) {
          // ignore start errors
        }
      }
    };

    try {
      recog.start();
    } catch (e) {
      console.warn("Failed to start recognition", e);
      return false;
    }

    recogRef.current = recog;
    setListening(true);
    return true;
  }

  function stopRecognition() {
    const r = recogRef.current;
    if (r) {
      try {
        r.onresult = null;
        r.onend = null;
        r.onerror = null;
        r.stop();
      } catch (e) {
        // ignore
      }
      recogRef.current = null;
    }
    setListening(false);
    setInterim("");
  }

  function toggleListening() {
    if (listening) stopRecognition();
    else startRecognitionWithLang(navigator.language || "en-US");
  }

  // restart recognition with a new language tag (applies when server detects language)
  function restartRecognitionWithLang(langTag) {
    // if current recognizer already uses the same language, skip
    try {
      const current = recogRef.current && recogRef.current.lang;
      if (current === langTag) return;
    } catch (e) {
      // ignore
    }
    // quick stop then start to apply new lang
    try {
      if (recogRef.current) {
        recogRef.current.onend = null;
        recogRef.current.stop();
      }
    } catch (e) {
      // ignore
    }
    // small delay to let the engine settle
    setTimeout(() => startRecognitionWithLang(langTag), 120);
  }

  return (
    <div style={{ padding: 12 }}>
      <div>
        <strong>Spacebar</strong> to toggle recording. Use Chrome for best results.
      </div>

      <div style={{ marginTop: 8 }}>
        <div>WS: {connected ? "connected" : "disconnected"}</div>
        <div>Listening: {listening ? "yes" : "no"}</div>
        <div>Detected language: {detectedLang || "—"}</div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div><small>Live (original):</small></div>
        <div style={{ minHeight: 36, border: "1px solid #ddd", padding: 8 }}>{interim}</div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div><small>Translation (english):</small></div>
        <div style={{ minHeight: 36, border: "1px solid #ddd", padding: 8 }}>{translation}</div>
      </div>

      <div style={{ marginTop: 12 }}>
        <button onClick={toggleListening}>{listening ? "Stop (Space)" : "Start (Space)"}</button>
      </div>

      <div style={{ marginTop: 12 }}>
        <details>
          <summary>Debug: last server message</summary>
          <pre style={{ maxHeight: 200, overflow: "auto" }}>{JSON.stringify(lastServerMsg, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}
