const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

function ensureFile(file, defaultValue) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            JSON.stringify(defaultValue, null, 2),
            "utf8"
        );
    }
}

ensureFile(USERS_FILE, []);
ensureFile(SESSIONS_FILE, {});

function loadUsers() {
    try {
        return JSON.parse(
            fs.readFileSync(USERS_FILE, "utf8")
        );
    } catch {
        return [];
    }
}

function saveUsers(users) {
    fs.writeFileSync(
        USERS_FILE,
        JSON.stringify(users, null, 2),
        "utf8"
    );
}

function loadSessions() {
    try {
        return JSON.parse(
            fs.readFileSync(SESSIONS_FILE, "utf8")
        );
    } catch {
        return {};
    }
}

function saveSessions(sessions) {
    fs.writeFileSync(
        SESSIONS_FILE,
        JSON.stringify(sessions, null, 2),
        "utf8"
    );
}

function normalizeUsername(username) {
    return String(username || "")
        .trim()
        .toLowerCase();
}

function createPasswordHash(password) {
    const salt = crypto.randomBytes(16).toString("hex");

    const hash = crypto.scryptSync(
        password,
        salt,
        64
    ).toString("hex");

    return {
        salt,
        hash
    };
}

function verifyPassword(password, salt, storedHash) {
    const hash = crypto.scryptSync(
        password,
        salt,
        64
    ).toString("hex");

    return crypto.timingSafeEqual(
        Buffer.from(hash, "hex"),
        Buffer.from(storedHash, "hex")
    );
}

function createSession(username) {
    const sessions = loadSessions();

    const token = crypto.randomBytes(32).toString("hex");

    sessions[token] = {
        username,
        createdAt: Date.now()
    };

    saveSessions(sessions);

    return token;
}

function getSession(token) {
    if (!token) {
        return null;
    }

    const sessions = loadSessions();
    return sessions[token] || null;
}

function deleteSession(token) {
    if (!token) {
        return;
    }

    const sessions = loadSessions();

    if (sessions[token]) {
        delete sessions[token];
        saveSessions(sessions);
    }
}

function getUser(username) {
    const users = loadUsers();

    return users.find(
        user => user.username === normalizeUsername(username)
    );
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ==========================================
// REGISTRO
// ==========================================

app.post("/api/register", (req, res) => {
    const usernameOriginal =
        String(req.body.username || "").trim();

    const password =
        String(req.body.password || "");

    if (usernameOriginal.length < 3) {
        return res.status(400).json({
            error: "El nombre debe tener al menos 3 caracteres."
        });
    }

    if (usernameOriginal.length > 24) {
        return res.status(400).json({
            error: "El nombre puede tener como máximo 24 caracteres."
        });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(usernameOriginal)) {
        return res.status(400).json({
            error: "El nombre solo puede usar letras, números y _."
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            error: "La contraseña debe tener al menos 6 caracteres."
        });
    }

    const username = normalizeUsername(usernameOriginal);

    const users = loadUsers();

    const exists = users.some(
        user => user.username === username
    );

    if (exists) {
        return res.status(400).json({
            error: "Ese usuario ya existe."
        });
    }

    const passwordData =
        createPasswordHash(password);

    users.push({
        username,
        displayName: usernameOriginal,
        salt: passwordData.salt,
        passwordHash: passwordData.hash,
        createdAt: Date.now()
    });

    saveUsers(users);

    const token = createSession(username);

    res.json({
        success: true,
        username: usernameOriginal,
        token
    });
});

// ==========================================
// LOGIN
// ==========================================

app.post("/api/login", (req, res) => {
    const username =
        normalizeUsername(req.body.username);

    const password =
        String(req.body.password || "");

    const user = getUser(username);

    if (!user) {
        return res.status(401).json({
            error: "Usuario o contraseña incorrectos."
        });
    }

    try {
        const valid =
            verifyPassword(
                password,
                user.salt,
                user.passwordHash
            );

        if (!valid) {
            return res.status(401).json({
                error: "Usuario o contraseña incorrectos."
            });
        }
    } catch {
        return res.status(401).json({
            error: "Usuario o contraseña incorrectos."
        });
    }

    const token = createSession(user.username);

    res.json({
        success: true,
        username: user.displayName,
        token
    });
});

// ==========================================
// COMPROBAR SESIÓN
// ==========================================

app.get("/api/session", (req, res) => {
    const token = req.headers.authorization
        ? req.headers.authorization.replace("Bearer ", "")
        : "";

    const session = getSession(token);

    if (!session) {
        return res.status(401).json({
            loggedIn: false
        });
    }

    const user = getUser(session.username);

    if (!user) {
        deleteSession(token);

        return res.status(401).json({
            loggedIn: false
        });
    }

    res.json({
        loggedIn: true,
        username: user.displayName,
        token
    });
});

// ==========================================
// CERRAR SESIÓN
// ==========================================

app.post("/api/logout", (req, res) => {
    const token = req.headers.authorization
        ? req.headers.authorization.replace("Bearer ", "")
        : "";

    deleteSession(token);

    res.json({
        success: true
    });
});

// ==========================================
// SOCKET.IO
// ==========================================

const users = new Map();

// socket.id -> username

const messages = new Map();

// username -> mensajes

io.on("connection", (socket) => {

    console.log("Conexión:", socket.id);

    // --------------------------------------
    // AUTENTICAR SOCKET CON TOKEN
    // --------------------------------------

    socket.on("authenticate", (token) => {

        const session = getSession(token);

        if (!session) {
            socket.emit("authenticationError");
            return;
        }

        const user = getUser(session.username);

        if (!user) {
            socket.emit("authenticationError");
            return;
        }

        // Si ya estaba conectado desde otro sitio,
        // desconectamos la sesión anterior.
        for (const [socketId, username] of users.entries()) {

            if (
                username === user.username &&
                socketId !== socket.id
            ) {
                users.delete(socketId);

                const oldSocket =
                    io.sockets.sockets.get(socketId);

                if (oldSocket) {
                    oldSocket.disconnect(true);
                }
            }
        }

        users.set(socket.id, user.username);

        if (!messages.has(user.username)) {
            messages.set(user.username, []);
        }

        socket.emit("authenticated", {
            username: user.displayName
        });

        sendUserList();

        console.log(
            `${user.displayName} ha conectado el chat.`
        );
    });

    // --------------------------------------
    // ENVIAR MENSAJE PRIVADO
    // --------------------------------------

    socket.on("privateMessage", ({ to, message }) => {

        const sender = users.get(socket.id);

        if (!sender) {
            socket.emit(
                "messageError",
                "No estás conectado."
            );
            return;
        }

        const text =
            String(message || "").trim();

        const target =
            normalizeUsername(to);

        if (!text || !target) {
            return;
        }

        const targetUser = getUser(target);

        if (!targetUser) {
            socket.emit(
                "messageError",
                "Ese usuario no existe."
            );
            return;
        }

        const messageData = {
            id:
                Date.now() +
                "-" +
                crypto
                    .randomBytes(5)
                    .toString("hex"),

            from: sender,
            to: target,

            message: text,

            time: new Date().toISOString(),

            read: false
        };

        if (!messages.has(target)) {
            messages.set(target, []);
        }

        messages.get(target).push(
            messageData
        );

        if (
            messages.get(target).length > 500
        ) {
            messages.get(target).shift();
        }

        // Buscar si está conectado
        const targetSocket =
            [...users.entries()]
                .find(
                    ([, username]) =>
                        username === target
                );

        if (targetSocket) {

            io.to(targetSocket[0]).emit(
                "privateMessage",
                messageData
            );
        }

        socket.emit(
            "messageSent",
            messageData
        );
    });

    // --------------------------------------
    // PEDIR MENSAJES
    // --------------------------------------

    socket.on("getMessages", () => {

        const username =
            users.get(socket.id);

        if (!username) {
            return;
        }

        socket.emit(
            "pendingMessages",
            messages.get(username) || []
        );
    });

    // --------------------------------------
    // MARCAR COMO LEÍDOS
    // --------------------------------------

    socket.on(
        "markConversationRead",
        ({ username }) => {

            const currentUser =
                users.get(socket.id);

            if (!currentUser) {
                return;
            }

            const history =
                messages.get(currentUser) || [];

            for (const msg of history) {

                if (
                    msg.from === username &&
                    msg.to === currentUser
                ) {
                    msg.read = true;
                }
            }
        }
    );

    // --------------------------------------
    // DESCONECTAR
    // --------------------------------------

    socket.on("disconnect", () => {

        const username =
            users.get(socket.id);

        if (username) {

            users.delete(socket.id);

            console.log(
                `${username} ha salido del chat.`
            );

            sendUserList();
        }
    });
});

function sendUserList() {

    const onlineUsernames =
        [...users.values()]
            .map(username => {

                const user =
                    getUser(username);

                return user
                    ? user.displayName
                    : username;
            });

    io.emit(
        "userList",
        onlineUsernames
    );
}

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "===================================="
        );
        console.log(
            "          MI CHAT"
        );
        console.log(
            "===================================="
        );
        console.log(
            `http://localhost:${PORT}`
        );
        console.log(
            "===================================="
        );
        console.log("");
    }
);