const PORT = 3000;
var express = require("express");
var http = require("http");
var app = express();
var server = http.createServer(app).listen(PORT);
var io = require("socket.io")(server);

const GAME_SIZE = 1000;
const NUM_OF_ASTEROIDS = 20;//20 20 20

function Vector2f(x, y) {
    this.x = x;
    this.y = y;

    this.mag2 = function() {
        return (this.x*this.x + this.y*this.y);
    };

    this.mag = function() {
        return Math.sqrt(this.mag2());
    };

    this.add = function(vec) {
        return new Vector2f(this.x+vec.x, this.y+vec.y);
    };

    this.subtract = function(vec) {
        return new Vector2f(this.x-vec.x, this.y-vec.y);
    };

    this.scale = function(a) {
        return new Vector2f(this.x*a, this.y*a);
    };
}

function Player(id, name, socket, x, y) {
    this.id = id;
    this.name = name;
    this.socket = socket;
    this.pos = new Vector2f(x, y);
    this.vel = new Vector2f(0.0, 0.0);
    this.rotation = 0.0;
    this.thrust = false;
    this.alive = true;
    this.score = 0;
    this.immunity = 3;

    this.getEPosInfo = function() {
        var info = {
            id: this.id,
            x: this.pos.x,
            y: this.pos.y,
            rotation: this.rotation,
            vx: this.vel.x,
            vy: this.vel.y,
            thrust: this.thrust
        };
        return info;
    };
    this.getPPosInfo = function() {
        var info = {
            x: this.pos.x,
            y: this.pos.y,
            rotation: this.rotation,
            vx: this.vel.x,
            vy: this.vel.y
        };
        return info;
    };
    this.kill = function() {
        console.log("User [" + this.name + "] has died.");
        this.alive = false;
        this.socket.emit("kill", id);
        this.socket.broadcast.emit("kill", id);
        updateLeader();
    };
}

function Asteroid(id, x, y) {
    this.id = id;
    this.pos = new Vector2f(x,y);
    var theta = Math.random()*Math.PI*2;
    this.size = id%3+1;
    this.radius = 0;
    switch (this.size) {
        case 1:
            this.radius = 10;
            break;
        case 2:
            this.radius = 15;
            break;
        case 3:
            this.radius = 25;
            break;
        default:
            break;
    }

    this.vel = new Vector2f(Math.cos(theta)*(6-1.5*this.size), Math.sin(theta)*(6-1.5*this.size));

    this.update = function() {
        this.pos.x += this.vel.x;
        this.pos.y += this.vel.y;
    };

    this.getInfo = function () {
        var info = {
            t: getTimeElapsed(),
            x: this.pos.x,
            y: this.pos.y,
            vx: this.vel.x,
            vy: this.vel.y,
            id: this.id
        };
        return info;
    };
}

var launch_time = Date.now();

var players = [];
var game_leader = -1;
var asteroids = [];

for (var i = 0; i < NUM_OF_ASTEROIDS; i++) {
    var x = Math.floor(Math.random()*GAME_SIZE);
    var y = Math.floor(Math.random()*GAME_SIZE);
    asteroids[i] = new Asteroid(i,x,y);
}

app.use(express.static("./public"));

io.on("connection", function(socket) {
    // console.log("Player connected.");

    socket.on("drip", function(){
        socket.emit("drop", getTimeElapsed());
    });

    var ipAddress = socket.request.connection.remoteAddress;
    socket.on("join", function(username) {
        console.log("User [" + username + "] has spawned with IP " + ipAddress);

        var id = nextID(players);

        var startX = Math.random()*GAME_SIZE;
        var startY = Math.random()*GAME_SIZE;

        socket.emit("id", {id: id, x: startX, y: startY, a: NUM_OF_ASTEROIDS, time: getTimeElapsed()});

        //TODO Do this for a few seconds after a player has joined to avoid early desync
        for (var i = 0; i < asteroids.length; i++) {
            socket.emit("a_pos", asteroids[i].getInfo());
        }


        //loop through all players
        for (var i = 0; i < players.length; i++) {
            //no player info here in the the array. move on
            if (players[i] == null) continue;

            //tell the joining player who's already in the game
            if (players[i].id != id) {
                var pinfo = {
                    id: players[i].id,
                    name: players[i].name
                };
                socket.emit("join", pinfo);
                if (!players[i].alive) socket.emit("kill", i);
            }
        }

        socket.emit("leader", {id: game_leader});

        players[id] = new Player(id, username, socket, startX, startY);
        socket.broadcast.emit("join", {id: id, name: username});

        socket.on("input", function(key) {
            if (!players[id].alive) return;

            players[id].thrust = false;

            //Left Arrow Key
            if (key == 37) {
                players[id].rotation -= 0.1;
            }
            //Right Arrow Key
            if (key == 39) {
                players[id].rotation += 0.1;
            }
            //Up Arrow Key
            if (key == 38) {
                players[id].thrust = true;
                players[id].vel.x += Math.cos(players[id].rotation);
                players[id].vel.y += Math.sin(players[id].rotation);
            }

        });

        socket.on("disconnect", function() {
            console.log("User [" + username + "] has disconnected!");
            socket.broadcast.emit("leave", id);
            players[id] = null;
        });

        updateLeader();
    });

});

function nextID(array) {
    for (var i = 0; i < i < array.length; i++) {
        if (array[i] == null) {
            return i;
        }
    }
    return array.length;
}

function getTimeElapsed() {
    return Date.now() - launch_time;
}

function updateLeader() {
    game_leader = -1;
    var best_score = -1;

    //loop through all players
    for (var i = 0; i < players.length; i++) {
        //no player info here in the the array. move on
        if (players[i] == null) continue;
        if (!players[i].alive) continue;

        if (players[i].score > best_score) {
            best_score = players[i].score;
            game_leader = i;
        }
    }

    io.sockets.emit("leader", {id: game_leader});
}

var tick = 0;
var FPS = 30;
setInterval(function () {
    tick++; tick%=30;

    //Update asteroids
    for (var i = 0; i < asteroids.length; i++) {
        asteroids[i].update();
        if (asteroids[i].pos.x < 0) {
            asteroids[i].pos.x += GAME_SIZE;
            io.sockets.emit("a_pos", asteroids[i].getInfo());
        }
        if (asteroids[i].pos.x > GAME_SIZE) {
            asteroids[i].pos.x -= GAME_SIZE;
            io.sockets.emit("a_pos", asteroids[i].getInfo());
        }
        if (asteroids[i].pos.y < 0) {
            asteroids[i].pos.y += GAME_SIZE;
            io.sockets.emit("a_pos", asteroids[i].getInfo());
        }
        if (asteroids[i].pos.y > GAME_SIZE) {
            asteroids[i].pos.y -= GAME_SIZE;
            io.sockets.emit("a_pos", asteroids[i].getInfo());
        }
    }

    //Update players
    for (var i = 0; i < players.length; i++) {
        if (players[i] != null && players[i].alive) {

            players[i].score++;
            if (tick == 0) {
                players[i].socket.emit("score", players[i].score);
                if (players[i].immunity > 0) players[i].immunity--; //TODO IMMUNITY
            }

            players[i].pos.x += players[i].vel.x;
            players[i].pos.y += players[i].vel.y;

            players[i].vel.x *= 0.9;
            players[i].vel.y *= 0.9;

            for (var j = 0; j < players.length; j++) {
                if (players[j] == null) continue;
                if (j == i) continue;
                if (!players[j].alive) continue;
                if (players[i].immunity > 0) continue;
                if (players[j].immunity > 0) continue;
                var dist = players[i].pos.subtract(players[j].pos);
                //TODO only emit positions close to player
                players[i].socket.emit("e_pos", players[j].getEPosInfo());

                if (dist.mag2() < 900) {
                    players[i].kill();
                    players[j].kill();
                }

            }

            players[i].socket.emit("p_pos", players[i].getPPosInfo());

            if (players[i] != null && (players[i].pos.x < 0 || players[i].pos.x > GAME_SIZE)) {
                players[i].kill();
            }
            if (players[i] != null && (players[i].pos.y < 0 || players[i].pos.y > GAME_SIZE)) {
                players[i].kill();
            }

            for (var a = 0; a < asteroids.length; a++) {
                var adist2 = players[i].pos.subtract(asteroids[a].pos);
                // console.log(asteroids[a]);
                if (players[i].immunity == 0 && adist2.mag() < (15.0+asteroids[a].radius)) {
                    players[i].kill();
                    // console.log("KILL");
                }
            }

        }
    }

}, 1000 / FPS);

console.log("Game server running on port " + PORT + "...");
