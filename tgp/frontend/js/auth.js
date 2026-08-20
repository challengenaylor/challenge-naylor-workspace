/* ==========================================================================
   TGP.auth — sign-in gate using your EXISTING Firebase Authentication
   (the same email/password login already used elsewhere on your site).
   Nothing new is created here — no new users, no new auth system — this
   just requires that existing login before the TGP dashboard loads or
   shows anything.

   The REAL lock is in the Firestore rules (require request.auth != null),
   not this file — this file only controls what the page displays. Even if
   someone bypassed this UI entirely, the database itself refuses to hand
   over data without a real signed-in session, matching the rules pasted
   into the Firebase Console alongside this update.
   ========================================================================== */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function showGate() {
    const gate = el('auth-gate');
    gate.hidden = false;
    gate.style.display = 'flex'; // must be set explicitly — the element's own inline
    // display:flex (needed to center the form) otherwise overrides the
    // [hidden]{display:none} default the moment we clear the attribute,
    // and conversely stays visually blocking clicks even while "hidden"
    // is set unless we also clear this style ourselves on hide (below).
    el('auth-gate-error').hidden = true;
  }

  function hideGate() {
    const gate = el('auth-gate');
    gate.hidden = true;
    gate.style.display = 'none';
  }

  function showError(message) {
    const box = el('auth-gate-error');
    box.textContent = message;
    box.hidden = false;
  }

  let started = false;

  async function startApp() {
    if (started) return; // onAuthStateChanged can fire more than once
    started = true;
    hideGate();
    window.TGP.dataReady = window.TGP.loadAllData();
    window.TGP.dataReady.then(() => {
      const badge = el('data-badge');
      if (badge) { badge.textContent = 'LIVE — reading real Firestore data'; badge.style.color = 'var(--success)'; }
    }).catch(() => {
      const badge = el('data-badge');
      if (badge) { badge.textContent = 'Could not connect to live data'; badge.style.color = 'var(--danger)'; }
    });
    await window.TGP.init();
  }

  function wireSignInForm() {
    const form = el('auth-gate-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = el('auth-email').value.trim();
      const password = el('auth-password').value;
      const btn = el('auth-submit');
      btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        await firebase.auth().signInWithEmailAndPassword(email, password);
        // onAuthStateChanged below handles the rest once this resolves.
      } catch (err) {
        showError(err.message || 'Could not sign in — check your email and password.');
      } finally {
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    });

    const signOutBtn = el('auth-signout');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', () => firebase.auth().signOut());
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireSignInForm();
    firebase.auth().onAuthStateChanged((user) => {
      if (user) {
        startApp();
      } else {
        started = false;
        showGate();
      }
    });
  });
}());
