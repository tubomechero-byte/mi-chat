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

// ==========================================
// CARPETA Y ARCHIVOS DE DATOS
// ==========================================

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
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
ensureFile(MESSAGES_FILE, []);
ensureFile(SESSIONS_FILE, {});

// ==========================================
// LECTURA Y ESCRITURA
// ==========================================

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

function loadMessages() {
    try {
        return JSON.parse(
            fs.readFileSync(MESSAGES_FILE, "utf8")
        );
    } catch {
        return [];
    }
}

function saveMessages(messages) {
    fs.writeFileSync(
        MESSAGES_FILE,
        JSON.stringify(messages, null, 2),
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

// ==========================================
// UTILIDADES
// ==========================================

function normalizeUsername(username) {
    return String(username || "")
        .trim()
        .toLowerCase();
}

function getUser(username) {
    const normalized = normalizeUsername(username);

    return loadUsers().find(
        user => user.username === normalized
    );
}

// ==========================================
// CONTRASEÑAS
// ==========================================

function createPasswordHash(password) {
    const salt = crypto
        .randomBytes(16)
        .toString("hex");

    const hash = crypto
        .scryptSync(password, salt, 64)
        .toString("hex");

    return {
        salt,
        hash
    };
}

function verifyPassword(
    password,
    salt,
    storedHash
) {
    const hash = crypto
        .scryptSync(password, salt, 64)
        .toString("hex");

    return crypto.timingSafeEqual(
        Buffer.from(hash, "hex"),
        Buffer.from(storedHash, "hex")
    );
}

// ==========================================
// SESIONES
// ==========================================

function createSession(username) {
    const sessions = loadSessions();

    const token = crypto
        .randomBytes(32)
        .toString("hex");

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

    delete sessions[token];

    saveSessions(sessions);
}

// ==========================================
// EXPRESS
// ==========================================

app.use(express.json());

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

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
            error:
                "El nombre debe tener al menos 3 caracteres."
        });
    }

    if (displayName.length > 24) {
        return res.status(400).json({
            error:
                "El nombre puede tener como máximo 24 caracteres."
        });
    }

    if (
        !/^[a-zA-Z0-9_]+$/.test(displayName)
    ) {
        return res.status(400).json({
            error:
                "El nombre solo puede usar letras, números y _."
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            error:
                "La contraseña debe tener al menos 6 caracteres."
        });
    }

    const username =
        normalizeUsername(displayName);

    const users = loadUsers();

    const exists = users.some(
        user => user.username === username
    );

    if (exists) {
        return res.status(400).json({
            error:
                "Ese usuario ya existe."
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

    res.json({
        success: true,
        username: displayName,
        token
    });

    // Actualizar lista para todos
    sendUserList();
});

// ==========================================
// LOGIN
// ==========================================

app.post("/api/login", (req, res) => {

    const username =
        normalizeUsername(
            req.body.username
        );

    const password =
        String(req.body.password || "");

    const user =
        getUser(username);

    if (!user) {
        return res.status(401).json({
            error:
                "Usuario o contraseña incorrectos."
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
                error:
                    "Usuario o contraseña incorrectos."
            });
        }

    } catch {

        return res.status(401).json({
            error:
                "Usuario o contraseña incorrectos."
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

    const auth =
        req.headers.authorization || "";

    const token =
        auth.startsWith("Bearer ")
            ? auth.slice(7)
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
        username: user.displayName,
        token
    });
});

// ==========================================
// LOGOUT
// ==========================================

app.post("/api/logout", (req, res) => {

    const auth =
        req.headers.authorization || "";

    const token =
        auth.startsWith("Bearer ")
            ? auth.slice(7)
            : "";

    deleteSession(token);

    res.json({
        success: true
    });
});

// ==========================================
// USUARIOS CONECTADOS
// socket.id -> username
// ==========================================

const onlineUsers = new Map();

// ==========================================
// SOCKET.IO
// ==========================================

io.on("connection", socket => {

    console.log(
        "Nueva conexión:",
        socket.id
    );

    // ======================================
    // AUTENTICAR SOCKET
    // ======================================

    socket.on(
        "authenticate",
        token => {

            const session =
                getSession(token);

            if (!session) {
                socket.emit(
                    "authenticationError"
                );
                return;
            }

            const user =
                getUser(
                    session.username
                );

            if (!user) {
                socket.emit(
                    "authenticationError"
                );
                return;
            }

            // Evitar dos conexiones simultáneas
            for (
                const [
                    socketId,
                    username
                ]
                of onlineUsers.entries()
            ) {

                if (
                    username ===
                    user.username &&
                    socketId !== socket.id
                ) {

                    onlineUsers.delete(
                        socketId
                    );

                    const oldSocket =
                        io.sockets.sockets.get(
                            socketId
                        );

                    if (oldSocket) {
                        oldSocket.disconnect(
                            true
                        );
                    }
                }
            }

            onlineUsers.set(
                socket.id,
                user.username
            );

            socket.emit(
                "authenticated",
                {
                    username:
                        user.displayName
                }
            );

            sendUserList();

            // Enviar contador de no leídos
            sendUnreadCounts(
                socket,
                user.username
            );

            console.log(
                `${user.displayName} está en línea.`
            );
        }
    );

    // ======================================
    // SOLICITAR HISTORIAL
    // ======================================

    socket.on(
        "getConversation",
        otherUsername => {

            const currentUser =
                onlineUsers.get(
                    socket.id
                );

            if (!currentUser) {
                return;
            }

            const other =
                normalizeUsername(
                    otherUsername
                );

            const allMessages =
                loadMessages();

            const conversation =
                allMessages.filter(msg => {

                    return (
                        (
                            msg.from === currentUser &&
                            msg.to === other
                        )
                        ||
                        (
                            msg.from === other &&
                            msg.to === currentUser
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
        ({ to, message }) => {

            const sender =
                onlineUsers.get(
                    socket.id
                );

            if (!sender) {
                socket.emit(
                    "messageError",
                    "No estás conectado."
                );
                return;
            }

            const target =
                normalizeUsername(to);

            const text =
                String(
                    message || ""
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

                from: sender,

                to: target,

                message: text,

                time:
                    new Date().toISOString(),

                read: false
            };

            // GUARDAR SIEMPRE
            const allMessages =
                loadMessages();

            allMessages.push(
                messageData
            );

            saveMessages(
                allMessages
            );

            // Si el destinatario está conectado,
            // entregarlo inmediatamente.
            const targetSocket =
                [...onlineUsers.entries()]
                    .find(
                        ([, username]) =>
                            username === target
                    );

            if (targetSocket) {

                io.to(
                    targetSocket[0]
                ).emit(
                    "privateMessage",
                    messageData
                );
            }

            // Confirmación al remitente
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
                onlineUsers.get(
                    socket.id
                );

            if (!currentUser) {
                return;
            }

            const other =
                normalizeUsername(
                    otherUsername
                );

            const allMessages =
                loadMessages();

            for (
                const msg of allMessages
            ) {

                if (
                    msg.from === other &&
                    msg.to === currentUser
                ) {
                    msg.read = true;
                }
            }

            saveMessages(
                allMessages
            );

            sendUnreadCounts(
                socket,
                currentUser
            );
        }
    );

    // ======================================
    // DESCONEXIÓN
    // ======================================

    socket.on(
        "disconnect",
        () => {

            const username =
                onlineUsers.get(
                    socket.id
                );

            if (username) {

                onlineUsers.delete(
                    socket.id
                );

                console.log(
                    `${username} se ha desconectado.`
                );

                sendUserList();
            }
        }
    );
});

// ==========================================
// ENVIAR TODOS LOS USUARIOS
// ==========================================

function sendUserList() {

    const users =
        loadUsers();

    const list =
        users.map(user => {

            const isOnline =
                [...onlineUsers.values()]
                    .includes(
                        user.username
                    );

            return {

                username:
                    user.username,

                displayName:
                    user.displayName,

                online:
                    isOnline
            };
        });

    io.emit(
        "userList",
        list
    );
}

// ==========================================
// ENVIAR CONTADORES DE NO LEÍDOS
// ==========================================

function sendUnreadCounts(
    socket,
    username
) {

    const allMessages =
        loadMessages();

    const unread = {};

    for (
        const msg of allMessages
    ) {

        if (
            msg.to === username &&
            !msg.read
        ) {

            unread[msg.from] =
                (unread[msg.from] || 0) + 1;
        }
    }

    socket.emit(
        "unreadCounts",
        unread
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
