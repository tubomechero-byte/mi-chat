# 🚀 ChatPulse - Despliegue en Render y GitHub

Aplicación de chat en tiempo real con Node.js, Express y Socket.IO adaptada para **GitHub** y **Render**.

---

## 📂 Subir a GitHub

1. Descomprime la carpeta del proyecto.
2. Abre la terminal dentro de la carpeta desencriptada (`chat-app`).
3. Inicializa Git y sube tus cambios:

```bash
git init
git add .
git commit -m "Initial commit - Chat App Render ready"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

---

## 🌐 Desplegar en Render (Render.com)

1. Inicia sesión en [Render.com](https://render.com).
2. Haz clic en **New +** -> **Web Service**.
3. Conecta tu cuenta de GitHub y selecciona el repositorio de la app.
4. Completa la configuración básica:
   - **Name**: `chat-app-pulse` (o el nombre que prefieras).
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Haz clic en **Create Web Service**. ¡Listo! Render compilará tu aplicación y te dará una URL pública HTTPS gratuita.
