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
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function ensureFile(file, value) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
    }
}

ensureFile(USERS_FILE, []);
ensureFile(MESSAGES_FILE, []);
ensureFile(SESSIONS_FILE, {});

function loadJSON(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function loadUsers() {
    return loadJSON(USERS_FILE, []);
}

function saveUsers(users) {
    saveJSON(USERS_FILE, users);
}

function loadMessages() {
    return loadJSON(MESSAGES_FILE, []);
}

function saveMessages(messages) {
    saveJSON(MESSAGES_FILE, messages);
}

function loadSessions() {
    return loadJSON(SESSIONS_FILE, {});
}

function saveSessions(sessions) {
    saveJSON(SESSIONS_FILE, sessions);
}

function normalizeUsername(username) {
    return String(username || "").trim().toLowerCase();
}

function getUser(username) {
    const normalized = normalizeUsername(username);

    return loadUsers().find(
        user => normalizeUsername(user.username) === normalized
    );
}

// ==========================================
// CONTRASEÑAS
// ==========================================

function createPasswordHash(password) {
    const salt = crypto.randomBytes(16).toString("hex");

    const hash = crypto
        .scryptSync(password, salt, 64)
        .toString("hex");

    return { salt, hash };
}

function verifyPassword(password, salt, storedHash) {
    try {
        const hash = crypto
            .scryptSync(password, salt, 64)
            .toString("hex");

        return crypto.timingSafeEqual(
            Buffer.from(hash, "hex"),
            Buffer.from(storedHash, "hex")
        );
    } catch {
        return false;
    }
}

// ==========================================
// SESIONES
// ==========================================

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
    if (!token) return null;

    return loadSessions()[token] || null;
}

function deleteSession(token) {
    if (!token) return;

    const sessions = loadSessions();

    delete sessions[token];

    saveSessions(sessions);
}

// ==========================================
// EXPRESS
// ==========================================

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ==========================================
// REGISTRO
// ==========================================

app.post("/api/register", (req, res) => {

    const displayName =
        String(req.body.username || "").trim();

    const password =
        String(req.body.password || "");

    if (displayName.length < 3) {
        return res.status(400).json({
            error: "El nombre debe tener al menos 3 caracteres."
        });
    }

    if (displayName.length > 24) {
        return res.status(400).json({
            error: "El nombre puede tener como máximo 24 caracteres."
        });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(displayName)) {
        return res.status(400).json({
            error: "El nombre solo puede usar letras, números y _."
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            error: "La contraseña debe tener al menos 6 caracteres."
        });
    }

    const username = normalizeUsername(displayName);

    const users = loadUsers();

    if (
        users.some(
            user =>
                normalizeUsername(user.username) === username
        )
    ) {
        return res.status(400).json({
            error: "Ese usuario ya existe."
        });
    }

    const passwordData =
        createPasswordHash(password);

    users.push({
        username,
        displayName,
        salt: passwordData.salt,
        passwordHash: passwordData.hash,
        createdAt: Date.now()
    });

    saveUsers(users);

    const token =
        createSession(username);

    sendUserList();

    res.json({
        success: true,
        username: displayName,
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

    if (
        !user ||
        !verifyPassword(
            password,
            user.salt,
            user.passwordHash
        )
    ) {
        return res.status(401).json({
            error: "Usuario o contraseña incorrectos."
        });
    }

    const token =
        createSession(user.username);

    res.json({
        success: true,
        username: user.displayName,
        token
    });
});

// ==========================================
// SESIÓN
// ==========================================

app.get("/api/session", (req, res) => {

    const authorization =
        req.headers.authorization || "";

    const token =
        authorization.startsWith("Bearer ")
            ? authorization.slice(7)
            : "";

    const session =
        getSession(token);

    if (!session) {
        return res.status(401).json({
            loggedIn: false
        });
    }

    const user =
        getUser(session.username);

    if (!user) {

        deleteSession(token);

        return res.status(401).json({
            loggedIn: false
        });
    }

    res.json({
        loggedIn: true,
        username: user.displayName
    });
});

// ==========================================
// LOGOUT
// ==========================================

app.post("/api/logout", (req, res) => {

    const authorization =
        req.headers.authorization || "";

    const token =
        authorization.startsWith("Bearer ")
            ? authorization.slice(7)
            : "";

    deleteSession(token);

    res.json({
        success: true
    });
});

// ==========================================
// USUARIOS CONECTADOS
// ==========================================

const onlineUsers = new Map();

// socket.id -> username

// ==========================================
// SOCKET.IO
// ==========================================

io.on("connection", socket => {

    // ======================================
    // AUTENTICAR
    // ======================================

    socket.on("authenticate", token => {

        const session =
            getSession(token);

        if (!session) {
            socket.emit("authenticationError");
            return;
        }

        const user =
            getUser(session.username);

        if (!user) {
            socket.emit("authenticationError");
            return;
        }

        for (
            const [socketId, username]
            of onlineUsers.entries()
        ) {

            if (
                normalizeUsername(username) ===
                normalizeUsername(user.username) &&
                socketId !== socket.id
            ) {

                onlineUsers.delete(socketId);

                const oldSocket =
                    io.sockets.sockets.get(socketId);

                if (oldSocket) {
                    oldSocket.disconnect(true);
                }
            }
        }

        onlineUsers.set(
            socket.id,
            user.username
        );

        socket.emit("authenticated", {
            username: user.displayName
        });

        sendUserList();

        sendUnreadCounts(
            socket,
            user.username
        );
    });

    // ======================================
    // COMPROBAR USUARIO PARA NUEVO CHAT
    // ======================================

    socket.on("findUser", username => {

        const currentUser =
            onlineUsers.get(socket.id);

        if (!currentUser) {
            return;
        }

        const target =
            normalizeUsername(username);

        if (!target) {
            socket.emit("userNotFound");
            return;
        }

        if (
            target ===
            normalizeUsername(currentUser)
        ) {
            socket.emit(
                "userFoundError",
                "No puedes contactar contigo mismo."
            );
            return;
        }

        const user =
            getUser(target);

        if (!user) {
            socket.emit("userNotFound");
            return;
        }

        const online =
            [...onlineUsers.values()]
                .some(
                    username =>
                        normalizeUsername(username) ===
                        target
                );

        socket.emit("userFound", {
            username: user.username,
            displayName: user.displayName,
            online
        });
    });

    // ======================================
    // HISTORIAL
    // ======================================

    socket.on(
        "getConversation",
        otherUsername => {

            const currentUser =
                onlineUsers.get(socket.id);

            if (!currentUser) return;

            const other =
                normalizeUsername(otherUsername);

            const user =
                getUser(other);

            if (!user) {
                return;
            }

            const allMessages =
                loadMessages();

            const conversation =
                allMessages.filter(msg => {

                    return (
                        (
                            normalizeUsername(msg.from) ===
                            normalizeUsername(currentUser) &&
                            normalizeUsername(msg.to) ===
                            other
                        )
                        ||
                        (
                            normalizeUsername(msg.from) ===
                            other &&
                            normalizeUsername(msg.to) ===
                            normalizeUsername(currentUser)
                        )
                    );
                });

            socket.emit(
                "conversationHistory",
                {
                    username: other,
                    messages: conversation
                }
            );
        }
    );

    // ======================================
    // ENVIAR MENSAJE
    // ======================================

    socket.on(
        "privateMessage",
        data => {

            const sender =
                onlineUsers.get(socket.id);

            if (!sender) {
                socket.emit(
                    "messageError",
                    "No estás conectado."
                );
                return;
            }

            const target =
                normalizeUsername(data?.to);

            const text =
                String(
                    data?.message || ""
                ).trim();

            if (!target || !text) {
                return;
            }

            const targetUser =
                getUser(target);

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

                from:
                    normalizeUsername(sender),

                fromDisplay:
                    getUser(sender)?.displayName ||
                    sender,

                to:
                    target,

                toDisplay:
                    targetUser.displayName,

                message:
                    text,

                time:
                    new Date().toISOString(),

                read:
                    false
            };

            const messages =
                loadMessages();

            messages.push(
                messageData
            );

            saveMessages(messages);

            // Entregar inmediatamente
            for (
                const [socketId, username]
                of onlineUsers.entries()
            ) {

                if (
                    normalizeUsername(username) ===
                    target
                ) {

                    io.to(socketId).emit(
                        "privateMessage",
                        messageData
                    );

                    break;
                }
            }

            socket.emit(
                "messageSent",
                messageData
            );
        }
    );

    // ======================================
    // MARCAR COMO LEÍDO
    // ======================================

    socket.on(
        "markConversationRead",
        otherUsername => {

            const currentUser =
                onlineUsers.get(socket.id);

            if (!currentUser) return;

            const other =
                normalizeUsername(
                    otherUsername
                );

            const messages =
                loadMessages();

            for (const message of messages) {

                if (
                    normalizeUsername(
                        message.from
                    ) === other &&
                    normalizeUsername(
                        message.to
                    ) ===
                    normalizeUsername(
                        currentUser
                    )
                ) {
                    message.read = true;
                }
            }

            saveMessages(messages);

            sendUnreadCounts(
                socket,
                currentUser
            );
        }
    );

    socket.on("disconnect", () => {

        onlineUsers.delete(socket.id);

        sendUserList();
    });
});

// ==========================================
// TODOS LOS USUARIOS
// ==========================================

function sendUserList() {

    const users =
        loadUsers();

    const onlineSet =
        new Set(
            [...onlineUsers.values()]
                .map(
                    username =>
                        normalizeUsername(username)
                )
        );

    const result =
        users.map(user => {

            const username =
                normalizeUsername(
                    user.username
                );

            return {
                username,
                displayName:
                    user.displayName ||
                    user.username,
                online:
                    onlineSet.has(username)
            };
        });

    io.emit(
        "userList",
        result
    );
}

// ==========================================
// NO LEÍDOS
// ==========================================

function sendUnreadCounts(
    socket,
    username
) {

    const currentUser =
        normalizeUsername(username);

    const messages =
        loadMessages();

    const counts = {};

    for (const message of messages) {

        if (
            normalizeUsername(
                message.to
            ) === currentUser &&
            message.read !== true
        ) {

            const from =
                normalizeUsername(
                    message.from
                );

            counts[from] =
                (counts[from] || 0) + 1;
        }
    }

    socket.emit(
        "unreadCounts",
        counts
    );
}

// ==========================================
// SERVIDOR
// ==========================================

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "===================================="
        );
        console.log(
            "             MI CHAT"
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
