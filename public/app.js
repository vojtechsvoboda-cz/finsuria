(() => {
  "use strict";

  // ---------- Header & menu ----------
  const header = document.querySelector(".site-header");
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.getElementById("menu");

  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const closeMenu = () => {
    toggle.setAttribute("aria-expanded", "false");
    nav.classList.remove("is-open");
  };
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  });
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

  document.querySelectorAll("[data-year]").forEach((el) => { el.textContent = new Date().getFullYear(); });

  // ---------- Form ----------
  const form = document.getElementById("poptavka");
  if (!form) return;

  const card = form.closest(".form-card");
  const done = card.querySelector(".form-done");
  const stepLabel = document.getElementById("step-label");
  const steps = [...form.querySelectorAll(".step")];
  const errorBox = form.querySelector(".form-error");
  const submitBtn = form.querySelector("[data-submit]");
  const submitLabel = submitBtn.querySelector(".btn-label");
  const phoneReq = form.querySelector(".req-phone");
  const startedAt = Date.now();
  const labels = { 1: "Krok 1 ze 2: Váš dům", 2: "Krok 2 ze 2: Kontakt" };

  let turnstileWidget = null;
  let turnstileReady = false;

  const showStep = (n, focus = true) => {
    form.dataset.current = String(n);
    steps.forEach((s) => {
      const active = s.dataset.step === String(n);
      s.hidden = !active;
      s.classList.toggle("is-entering", active);
    });
    stepLabel.textContent = labels[n];
    if (focus) {
      const first = steps[n - 1].querySelector("input:not([type=hidden]):not([tabindex='-1']), select, textarea");
      if (first) first.focus({ preventScroll: true });
      const top = card.getBoundingClientRect().top + window.scrollY - 100;
      if (window.scrollY > top) window.scrollTo({ top, behavior: "smooth" });
    }
    if (n === 2) loadTurnstile();
  };

  const setError = (name, msg) => {
    const field = form.querySelector(`[name="${name}"]`)?.closest(".field");
    const slot = form.querySelector(`.error[data-for="${name}"]`);
    if (field) field.classList.toggle("is-invalid", Boolean(msg));
    if (slot) slot.textContent = msg || "";
    const input = form.querySelector(`[name="${name}"]`);
    if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
  };

  const val = (name) => (form.elements[name]?.value || "").trim();
  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  const phoneOk = (v) => v.replace(/[^\d]/g, "").length >= 9;
  const prefersPhone = () => form.querySelector("[name=preferovany_kontakt]:checked")?.value === "Telefonicky";

  const validate = (step) => {
    const errs = {};
    if (step === 1) {
      if (!val("svj")) errs.svj = "Vyplňte název SVJ nebo adresu domu.";
    }
    if (step === 2) {
      if (!val("jmeno")) errs.jmeno = "Vyplňte jméno a příjmení.";
      if (!val("role")) errs.role = "Vyberte svou roli v SVJ.";
      if (!val("email")) errs.email = "Vyplňte e-mail.";
      else if (!emailOk(val("email"))) errs.email = "E-mail nemá správný tvar, zkontrolujte ho.";
      if (prefersPhone() && !val("telefon")) errs.telefon = "Chcete, abychom zavolali. Doplňte prosím telefon.";
      else if (val("telefon") && !phoneOk(val("telefon"))) errs.telefon = "Telefon by měl mít aspoň 9 číslic.";
    }
    const names = step === 1 ? ["svj"] : ["jmeno", "role", "email", "telefon"];
    names.forEach((n) => setError(n, errs[n]));
    const firstBad = names.find((n) => errs[n]);
    if (firstBad) form.elements[firstBad].focus();
    return !firstBad;
  };

  // live clear errors
  form.addEventListener("input", (e) => {
    const name = e.target.name;
    if (name && e.target.closest(".field.is-invalid")) setError(name, "");
  });
  form.addEventListener("change", (e) => {
    if (e.target.name === "preferovany_kontakt") {
      phoneReq.hidden = !prefersPhone();
      setError("telefon", "");
    }
  });
  phoneReq.hidden = !prefersPhone();

  form.querySelector("[data-next]").addEventListener("click", () => { if (validate(1)) showStep(2); });
  form.querySelector("[data-back]").addEventListener("click", () => showStep(1));
  // Enter in step 1 text input moves on instead of submitting
  steps[0].addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT") {
      e.preventDefault();
      if (validate(1)) showStep(2);
    }
  });

  // Hero / nav CTA focuses the form
  document.querySelectorAll("[data-start-form]").forEach((a) =>
    a.addEventListener("click", () => setTimeout(() => {
      if (form.dataset.current !== "2" && !form.hidden) form.elements.svj?.focus({ preventScroll: true });
    }, 450))
  );

  // ---------- Turnstile (optional, configured on the server) ----------
  let configPromise = null;
  const getConfig = () => {
    if (!configPromise) {
      configPromise = fetch("/api/config", { headers: { accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
    }
    return configPromise;
  };

  async function loadTurnstile() {
    if (turnstileReady) return;
    const cfg = await getConfig();
    if (!cfg.turnstileSiteKey) return;
    turnstileReady = true;
    window.onTurnstileLoad = () => {
      turnstileWidget = window.turnstile.render("#turnstile", {
        sitekey: cfg.turnstileSiteKey,
        language: "cs",
        appearance: "interaction-only",
      });
    };
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit";
    s.async = true;
    document.head.appendChild(s);
  }

  // ---------- Submit ----------
  const setBusy = (busy) => {
    submitBtn.disabled = busy;
    submitBtn.setAttribute("aria-busy", String(busy));
    if (busy) {
      submitLabel.textContent = "Odesíláme…";
      if (!submitBtn.querySelector(".spinner")) submitBtn.insertAdjacentHTML("afterbegin", '<span class="spinner" aria-hidden="true"></span>');
    } else {
      submitLabel.textContent = "Požádat o kontaktování";
      submitBtn.querySelector(".spinner")?.remove();
    }
  };

  const showFormError = (msg) => {
    errorBox.textContent = msg;
    errorBox.hidden = !msg;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showFormError("");
    if (!validate(1)) { showStep(1); return; }
    if (!validate(2)) return;

    const data = {
      svj: val("svj"),
      pocet_jednotek: val("pocet_jednotek"),
      vytapeni: val("vytapeni"),
      temata: [...form.querySelectorAll("[name=temata]:checked")].map((i) => i.value),
      zprava: val("zprava"),
      jmeno: val("jmeno"),
      role: val("role"),
      email: val("email"),
      telefon: val("telefon"),
      preferovany_kontakt: form.querySelector("[name=preferovany_kontakt]:checked")?.value || "",
      web: form.elements.web.value,
      elapsed: Date.now() - startedAt,
      turnstile: turnstileWidget !== null && window.turnstile ? window.turnstile.getResponse(turnstileWidget) || "" : "",
    };

    setBusy(true);
    try {
      const res = await fetch("/api/poptavka", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        if (body.fields) {
          Object.entries(body.fields).forEach(([k, m]) => setError(k, m));
          if (Object.keys(body.fields).some((k) => ["svj"].includes(k))) showStep(1);
          showFormError(body.error || "Zkontrolujte označená pole.");
          return;
        }
        throw new Error(body.error || "Poptávku se nepodařilo odeslat.");
      }
      // success
      const who = data.preferovany_kontakt === "Telefonicky" && data.telefon
        ? `Zavoláme vám na ${data.telefon} do dvou pracovních dnů.`
        : `Odpovíme vám na ${data.email} do dvou pracovních dnů.`;
      done.querySelector(".done-text").textContent = who;
      form.hidden = true;
      done.hidden = false;
      done.focus();
    } catch (err) {
      showFormError(`${err.message} Zkuste to prosím znovu za chvíli.`);
      if (turnstileWidget !== null && window.turnstile) window.turnstile.reset(turnstileWidget);
    } finally {
      setBusy(false);
    }
  });

  done.querySelector("[data-reset]").addEventListener("click", () => {
    form.reset();
    phoneReq.hidden = !prefersPhone();
    done.hidden = true;
    form.hidden = false;
    if (turnstileWidget !== null && window.turnstile) window.turnstile.reset(turnstileWidget);
    showStep(1);
  });

  showStep(1, false);
})();
