const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const app = express();
const server = http.createServer(app);
const { InMemorySessionStore } = require("./sessionStore");
const sessionStore = new InMemorySessionStore();
const crypto = require("crypto");
const randomId = () => crypto.randomBytes(8).toString("hex");
const { ExpressPeerServer } = require("peer");


const io = new Server(server, {
    cors: {
      origin: "*",
    }
});

app.use(cors());

const peerServer = ExpressPeerServer(server, {
    debug: true,
});
app.use("/peerjs", peerServer);

function startConnections() {
    io.use((socket, next) => {
        const sessionID = socket.handshake.auth.sessionID;
        const username = socket.handshake.auth.username;
        const peerID = socket.handshake.auth.peerID;

        if (sessionID) {
            console.lop('session: ', sessionID);
            const session = sessionStore.findSession(sessionID);

            if (session) {
                socket.sessionID = sessionID;
                socket.userID = session.userID;
                socket.username = session.username;
                return next();
            }
        }

        if (!username) {
            return next(new Error("invalid username"));
        }

        socket.sessionID = randomId();
        socket.userID = randomId();
        socket.username = username;
        socket.peerID = peerID;
        next();
    });


    io.on('connection', (socket) => {
        sessionStore.saveSession(socket.sessionID, {
            userID: socket.userID,
            username: socket.username,
            peerID: socket.peerID,
            connected: true
        });
        
        console.log('user', {
            userID: socket.userID,
            username: socket.username,
            peerID: socket.peerID,
            connected: true
        })

        socket.emit("session", {
            sessionID: socket.sessionID,
            userID: socket.userID,
            peerID: socket.peerID
        });


        socket.join(socket.userID);


        const usersOnline = [];
        const newUser = {
            userID: socket.userID,	   
            username: socket.username,
            peerID: socket.peerID,
            connected: true,
        }

        sessionStore.findAllSessions().forEach((session) => {
            usersOnline.push({
                userID: session.userID,
                username: session.username,
                peerID: session.peerID,
                connected: session.connected
            });
        });

        socket.emit("users", usersOnline);
        socket.broadcast.emit('add user', {newUser, usersOnline});

        socket.on('private message', ({content, time, type, to}) => {
            socket.to(to).to(socket.userID).emit('private message', {
                content,
                time,
                type,
                from: socket.userID,
                to
            });
        });

        socket.on('private endcall', ({to}) => {
            socket.to(to).to(socket.userID).emit('private endcall', {});
        });

        socket.on("disconnect", async () => {
            const matchingSockets = await io.in(socket.userID).fetchSockets();
            const isDisconnected = matchingSockets.size === 0;
            if (isDisconnected) {
                socket.broadcast.emit("user disconnected", socket.userID);

                sessionStore.saveSession(socket.sessionID, {
                    userID: socket.userID,
                    username: socket.username,
                    connected: false,
                });
            }
        });
    });

}


server.listen(process.env.PORT || 3000, () => {
    console.log('Server UP');
    console.log('Connection started: listening');

    startConnections();
});


