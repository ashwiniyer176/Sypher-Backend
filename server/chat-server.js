const WebSocket = require("ws");
var models = require("./server.js").models;

const ws = new WebSocket.Server({ port: 8080 });
const clients = [];
ws.on("connection", (ws) => {
  function login(email, pass) {
    models.User.login(
      {
        email: email,
        password: pass,
      },
      (err, res) => {
        if (err) {
          console.log("Error1:", err);
          ws.send(
            JSON.stringify({
              type: "ERROR",
              error: err,
            })
          );
        } else {
          console.log("Finding model");
          models.User.findOne(
            { where: { id: res.userId }, include: "Profile" },
            (err2, user) => {
              if (err2) {
                console.log(err2);
                ws.send(
                  JSON.stringify({
                    type: "ERROR",
                    error: err2,
                  })
                );
              } else {
                const userObject = {
                  id: user.id,
                  email: user.email,
                  ws: ws,
                };
                clients.push(userObject);
                console.log("Current Clients:", clients);
                ws.send(
                  JSON.stringify({
                    type: "LOGGEDIN",
                    data: {
                      session: res,
                      user: user,
                    },
                  })
                );
              }
            }
          );
        }
      }
    );
  }
  ws.on("message", (message) => {
    console.log("Got Message:", JSON.parse(message));
    let parsed = JSON.parse(message);
    if (parsed) {
      switch (parsed.type) {
        case "SIGNUP":
          models.User.create(parsed.data, (err, user) => {
            if (err) {
              ws.send(
                JSON.stringify({
                  type: "ERROR",
                  error: err,
                })
              );
            } else {
              models.Profile.create(
                {
                  userId: user.id,
                  name: parsed.data.name,
                  email: parsed.data.email,
                },
                (profileError, profile) => {
                  console.log("Profile Created:", profile);
                  ws.send(
                    JSON.stringify({
                      type: "CREATED PROFILE",
                      data: profile,
                    })
                  );
                }
              );
            }
          });
          break;

        case "LOGIN":
          login(parsed.data.email, parsed.data.password);
          break;

        case "SEARCH":
          console.log("Searching for:", parsed.data);
          models.User.find(
            { where: { email: { like: parsed.data } } },
            (err, users) => {
              if (!err && users) {
                console.log("Got users:", users);
                ws.send(
                  JSON.stringify({
                    type: "GOT_USERS",
                    data: users,
                  })
                );
              }
            }
          );
          break;

        case "FIND_THREAD":
          models.thread.findOne(
            {
              where: {
                and: [
                  { users: { like: parsed.data[0] } },
                  { users: { like: parsed.data[1] } },
                ],
              },
            },
            (err, thread) => {
              if (!err && thread) {
                ws.send(
                  JSON.stringify({
                    type: "ADD_THREAD",
                    data: thread,
                  })
                );
              } else {
                models.thread.create(
                  {
                    lastUpdated: new Date(),
                    users: parsed.data,
                  },
                  (err2, thread) => {
                    if (!err2 && thread) {
                      clients
                        .filter(
                          (u) => thread.users.indexOf(u.id.toString()) > -1
                        )
                        .map((client) => {
                          console.log("Client:", client);
                          client.ws.send(
                            JSON.stringify({
                              type: "ADD_THREAD",
                              data: thread,
                            })
                          );
                        });
                    }
                  }
                );
              }
            }
          );
          break;

        case "CONNECT_WITH_TOKEN":
          models.User.findById(parsed.data.userId, (err2, user) => {
            if (!err2 && user) {
              const userObject = {
                id: user.id,
                email: user.email,
                ws: ws,
              };
              clients.push(userObject);
              console.log("Current Clients:", clients);
              ws.send(
                JSON.stringify({
                  type: "LOGGEDIN",
                  data: {
                    session: res,
                    user: user,
                  },
                })
              );
            }
          });
          break;

        // case 'THREAD_LOAD':

        default:
          console.log("Nothing to see here");
      }
    }
  });
});
