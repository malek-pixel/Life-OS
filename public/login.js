// Sign-in page behaviour. Plain script, no dependencies, nothing from the app.
(function () {
  'use strict';

  var form = document.getElementById('login-form');
  var input = document.getElementById('password');
  var button = document.getElementById('submit');
  var label = button.querySelector('.label');
  var errorBox = document.getElementById('login-error');
  var inFlight = false;

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    input.setAttribute('aria-invalid', 'true');
  }

  function clearError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
    input.removeAttribute('aria-invalid');
  }

  function setBusy(busy) {
    inFlight = busy;
    button.disabled = busy;
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
    label.textContent = busy ? 'Signing in…' : 'Sign in';
  }

  // Only ever return to an in-app hash route on this same origin. The value is
  // checked against a strict pattern, so the page cannot be used as a redirect.
  function destination() {
    var hash = window.location.hash;
    return /^#\/[A-Za-z0-9\-\/?=&._~%]*$/.test(hash) ? '/' + hash : '/';
  }

  input.addEventListener('input', clearError);

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (inFlight) return; // rapid repeated taps send one request
    clearError();

    var password = input.value;
    if (!password) {
      showError('Enter your password.');
      input.focus();
      return;
    }

    setBusy(true);
    fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: password }),
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () { return {}; })
          .then(function (body) { return { status: response.status, body: body }; });
      })
      .then(function (result) {
        if (result.status === 200) {
          input.value = '';
          // replace(): the sign-in page should not sit in history behind the app.
          window.location.replace(destination());
          return;
        }
        setBusy(false);
        input.select();
        showError(
          (result.body && result.body.message) ||
            (result.status === 429 ? 'Too many attempts. Wait a few minutes and try again.' : 'Sign-in failed. Try again.'),
        );
      })
      .catch(function () {
        setBusy(false);
        showError('Could not reach Life OS. Check your connection and try again.');
      });
  });

  // Returning here via Back from a cached page: reset any stale busy state.
  window.addEventListener('pageshow', function () { setBusy(false); });
})();
