/* ==========================================================================
   auth.js — shared authentication helpers + login/register form logic.
   Loaded on login.html, register.html and chat.html.
   ========================================================================== */

const CHAT_TOKEN_KEY = 'chat_token';

function getToken() {
  try {
    return localStorage.getItem(CHAT_TOKEN_KEY);
  } catch (err) {
    return null;
  }
}

function setToken(token) {
  try {
    localStorage.setItem(CHAT_TOKEN_KEY, token);
  } catch (err) {
    /* storage unavailable */
  }
}

function clearToken() {
  try {
    localStorage.removeItem(CHAT_TOKEN_KEY);
  } catch (err) {
    /* storage unavailable */
  }
}

/**
 * Small JSON fetch wrapper used by every page.
 * Returns { ok, status, data } and never throws for HTTP errors.
 */
async function apiRequest(path, options) {
  const opts = options || {};
  const method = opts.method || 'GET';
  const body = opts.body;
  // Callers can pass token: null for public endpoints (login/register).
  const token = 'token' in opts ? opts.token : getToken();

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }
  return { ok: res.ok, status: res.status, data: data };
}

function isValidEmail(value) {
  return /^\S+@\S+\.\S+$/.test(value);
}

function setLoading(button, isLoading, loadingText) {
  if (!button) return;
  if (isLoading) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.classList.add('is-loading');
    button.textContent = loadingText || 'Please wait…';
  } else {
    button.disabled = false;
    button.classList.remove('is-loading');
    if (button.dataset.label) button.textContent = button.dataset.label;
  }
}

function showBanner(el, message) {
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

function hideBanner(el) {
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

function queryParam(name) {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch (err) {
    return null;
  }
}

/* ------------------------ Password visibility toggles ---------------------- */
document.addEventListener('click', (event) => {
  const btn = event.target.closest('.toggle-pass');
  if (!btn) return;
  const input = document.getElementById(btn.dataset.target);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? 'Hide' : 'Show';
});

/* ------------------------------- Login form -------------------------------- */
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  const errorBox = document.getElementById('formError');
  const infoBox = document.getElementById('infoBanner');
  const submitBtn = document.getElementById('submitBtn');

  if (queryParam('registered')) {
    showBanner(infoBox, 'Account created — log in to continue.');
  } else if (queryParam('loggedout')) {
    showBanner(infoBox, 'You have been logged out.');
  } else if (queryParam('expired')) {
    showBanner(errorBox, 'Your session is invalid or has expired. Please log in again.');
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideBanner(errorBox);

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    const errors = [];
    if (!email) errors.push('Email is required.');
    else if (!isValidEmail(email)) errors.push('Enter a valid email address.');
    if (!password) errors.push('Password is required.');
    if (errors.length) {
      showBanner(errorBox, errors.join(' '));
      return;
    }

    setLoading(submitBtn, true, 'Logging in…');
    try {
      const result = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email, password },
        token: null,
      });
      if (!result.ok || !result.data || !result.data.token) {
        showBanner(
          errorBox,
          (result.data && result.data.message) || 'Login failed. Please try again.'
        );
        return;
      }
      setToken(result.data.token);
      window.location.href = '/chat.html';
    } catch (err) {
      showBanner(errorBox, 'Could not reach the server. Make sure it is running.');
    } finally {
      setLoading(submitBtn, false);
    }
  });
}

/* ------------------------------ Register form ------------------------------ */
const registerForm = document.getElementById('registerForm');
if (registerForm) {
  const errorBox = document.getElementById('formError');
  const submitBtn = document.getElementById('submitBtn');

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideBanner(errorBox);

    const username = document.getElementById('username').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    const errors = [];
    if (!username) errors.push('Username is required.');
    else if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      errors.push('Username may only contain letters, numbers and underscores.');
    } else if (username.length < 3 || username.length > 20) {
      errors.push('Username must be 3–20 characters.');
    }

    if (!email) errors.push('Email is required.');
    else if (!isValidEmail(email)) errors.push('Enter a valid email address.');

    if (!password) errors.push('Password is required.');
    else if (password.length < 8) errors.push('Password must be at least 8 characters.');

    if (!confirmPassword) errors.push('Please confirm your password.');
    else if (password !== confirmPassword) errors.push('Passwords do not match.');

    if (errors.length) {
      showBanner(errorBox, errors.join(' '));
      return;
    }

    setLoading(submitBtn, true, 'Creating account…');
    try {
      const result = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: { username, email, password, confirmPassword },
        token: null,
      });
      if (!result.ok) {
        showBanner(
          errorBox,
          (result.data && result.data.message) || 'Registration failed. Please try again.'
        );
        return;
      }
      // Workflow: register → login page (with a success banner) → chat.
      window.location.href = '/login.html?registered=1';
    } catch (err) {
      showBanner(errorBox, 'Could not reach the server. Make sure it is running.');
    } finally {
      setLoading(submitBtn, false);
    }
  });
}
