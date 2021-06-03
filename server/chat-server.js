const WebSocket = require("ws");
var models = require("./server.js").models;

const ws = new WebSocket.Server({ port: 8080 });
const clients = [];

ws.on("connection", (ws) => {
  function getInitialThreads(userId) {
    models.thread.find({ where: {}, include: "Messages" }, (err, threads) => {
      if (err) throw err;
      else {
        if (threads) {
          threads.map((thread, i) => {
            models.User.find(
              { where: { id: { inq: thread.users } } },
              (err3, users) => {
                if (err3) throw err3;
                else {
                  if (users) {
                    threads.profiles = users;
                    if (i === threads.length - 1) {
                      ws.send(
                        JSON.stringify({
                          type: "INITIAL_THREADS",
                          data: threads,
                        })
                      );
                    }
                  }
                }
              }
            );
          });
        }
      }
    });
  }

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
                ws.uid = user.id + new Date().getTime().toString();
                const userObject = {
                  id: user.id,
                  email: user.email,
                  ws: ws,
                };

                clients.push(userObject);
                getInitialThreads(user.id);
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

  ws.on("close", (req) => {
    console.log("Closing the Socket", req);
    let clientIndex = -1;
    clients.map((c, i) => {
      if (c.ws._closeCode === req) {
        clientIndex = i;
      }
    });
    if (clientIndex > -1) {
      clients.splice(clientIndex, 1);
    }
  });

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
          console.log("Data:", parsed);
          models.User.findById(parsed.data.userId, (err2, user) => {
            if (!err2 && user) {
              ws.uid = user.id + new Date().getTime().toString();
              const userObject = {
                id: user.id,
                email: user.email,
                ws: ws,
              };
              console.log("Connecting with token");
              clients.push(userObject);
              console.log("Current Clients:", clients);
              getInitialThreads(user.id);
            }
          });
          break;

        case "THREAD_LOAD":
          models.Message.find(
            {
              where: {
                threadId: parsed.data.threadId,
              },
              orderBy: "date ASC",
              skip: parsed.data.skip,
              limit: 10,
            },
            (err2, messages) => {
              if (err2) throw err2;
              else {
                ws.send(
                  JSON.stringify({
                    type: "GOT_MESSAGES",
                    threadId: parsed.data.threadId,
                    messages: messages,
                  })
                );
              }
            }
          );
          break;

        case "ADD_MESSAGE":
          models.thread.findById(parsed.threadId, (err2, thread) => {
            if (err2) throw err2;
            else {
              if (thread) {
                models.Message.upsert(
                  parsed.message,
                  (messageError, message) => {
                    if (messageError) throw messageError;
                    else {
                      clients
                        .filter(
                          (client) =>
                            thread.users.indexOf(client.id.toString()) > -1
                        )
                        .map((client) => {
                          client.ws.send(
                            JSON.stringify({
                              type: "ADD_MESSAGE_TO_THREAD",
                              threadId: parsed.threadId,
                              message: message,
                            })
                          );
                        });
                    }
                  }
                );
              }
            }
          });
          break;

        default:
          console.log("Nothing to see here");
      }
    }
  });
});
