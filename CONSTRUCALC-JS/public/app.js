'use strict';



async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.message || 'No se pudo completar la solicitud.');
  return data;
}

function showMessage(form, message, type = 'error') {
  if (!form) return;
  let target = form.querySelector('[data-message]');
  if (!target) {
    target = document.createElement('div');
    target.className = 'mensaje-formulario';
    target.setAttribute('role', 'status');
    target.setAttribute('aria-live', 'polite');
    form.appendChild(target);
  }
  target.textContent = message;
  target.classList.remove('mensaje-error', 'mensaje-ok');
  target.classList.add(type === 'success' ? 'mensaje-ok' : 'mensaje-error');
}

function getValue(form, id) {
  const element = form.querySelector(`#${id}`);
  return element ? element.value.trim() : '';
}

function setBusy(form, busy, buttonText) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = buttonText || 'Procesando…';
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

const loginForm = document.querySelector('#login-form');
if (loginForm) {
  const params = new URLSearchParams(window.location.search);
  if (params.get('registrado') === '1') showMessage(loginForm, 'Cuenta creada. Ya puedes iniciar sesión.', 'success');

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const username = getValue(loginForm, 'usuario');
    const password = loginForm.querySelector('#contrasena').value;
    if (!username || !password) return showMessage(loginForm, 'Completa el usuario y la contraseña.');
    setBusy(loginForm, true, 'Ingresando…');
    try {
      await apiRequest('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      window.location.href = '04-menu.html';
    } catch (error) {
      showMessage(loginForm, error.message);
      setBusy(loginForm, false);
    }
  });
}

const registerForm = document.querySelector('#registro-form');
if (registerForm) {
  registerForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!registerForm.reportValidity()) return;
    const username = getValue(registerForm, 'usuario');
    const password = registerForm.querySelector('#contrasena').value;
    const confirm = registerForm.querySelector('#confirmar').value;
    if (password !== confirm) return showMessage(registerForm, 'Las contraseñas no coinciden.');
    if (password.length < 8) return showMessage(registerForm, 'La contraseña debe tener al menos 8 caracteres.');
    setBusy(registerForm, true, 'Creando cuenta…');
    try {
      const data = await apiRequest('/api/register', {
        method: 'POST', body: JSON.stringify({ username, password }),
      });
      showMessage(registerForm, data.message, 'success');
      setTimeout(() => { window.location.href = '01-login.html?registrado=1'; }, 900);
    } catch (error) {
      showMessage(registerForm, error.message);
      setBusy(registerForm, false);
    }
  });
}

const recoverForm = document.querySelector('#recuperar-form');
if (recoverForm) {
  recoverForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!recoverForm.reportValidity()) return;
    const username = getValue(recoverForm, 'usuario');
    const recoveryCode = recoverForm.querySelector('#codigo-recuperacion').value.trim();
    const newPassword = recoverForm.querySelector('#nueva-contrasena').value;
    const confirm = recoverForm.querySelector('#confirmar').value;
    if (newPassword !== confirm) return showMessage(recoverForm, 'Las contraseñas no coinciden.');
    if (newPassword.length < 8) return showMessage(recoverForm, 'La nueva contraseña debe tener al menos 8 caracteres.');
    setBusy(recoverForm, true, 'Restableciendo…');
    try {
      const data = await apiRequest('/api/recover', {
        method: 'POST', body: JSON.stringify({ username, recoveryCode, newPassword }),
      });
      showMessage(recoverForm, data.message, 'success');
      setTimeout(() => { window.location.href = '01-login.html'; }, 1200);
    } catch (error) {
      showMessage(recoverForm, error.message);
      setBusy(recoverForm, false);
    }
  });
}

const menuUser = document.querySelector('.header-usuario');
if (menuUser) {
  apiRequest('/api/me', { method: 'GET', headers: {} })
    .then(data => {
      if (!data.loggedIn) {
        window.location.replace('01-login.html');
        return;
      }
      menuUser.textContent = `Hola, ${data.username}`;
    })
    .catch(() => { window.location.replace('01-login.html'); });
}

const logoutButton = document.querySelector('#cerrar-sesion');
if (logoutButton) {
  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true;
    try { await apiRequest('/api/logout', { method: 'POST', body: '{}' }); }
    finally { window.location.href = '01-login.html'; }
  });
}

for (const form of document.querySelectorAll('form[data-calculadora]')) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = {};
    for (const element of form.elements) {
      if (element.name && element.type !== 'submit' && element.type !== 'button') {
        values[element.name] = element.value;
      }
    }
    setBusy(form, true, 'Calculando…');
    try {
      const result = await apiRequest('/api/calcular', {
        method: 'POST',
        body: JSON.stringify({ type: form.dataset.calculadora, values }),
      });
      const resultBox = form.parentElement.querySelector('.resultado');
      const initial = resultBox.querySelector('.resultado-inicial');
      const list = resultBox.querySelector('.resultado-lista');
      const note = resultBox.querySelector('.nota-calculo');
      if (initial) initial.hidden = true;
      list.replaceChildren();
      for (const item of result.items || []) {
        const li = document.createElement('li');
        const label = document.createElement('strong');
        label.textContent = `${item.label}: `;
        const value = document.createElement('span');
        value.textContent = item.value;
        li.append(label, value);
        list.appendChild(li);
      }
      resultBox.querySelector('h2').textContent = result.title || 'Resultado';
      note.textContent = result.note || '';
      showMessage(form, 'Cálculo realizado correctamente.', 'success');
    } catch (error) {
      showMessage(form, error.message);
    } finally {
      setBusy(form, false);
    }
  });
}
