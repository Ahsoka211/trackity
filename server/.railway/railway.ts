import { defineRailway, github, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const data = volume("server-data", { sizeMB: 1024 });

  const web = service("trackity-server", {
    source: github("Ahsoka211/trackity", { branch: "main", rootDirectory: "server" }),
    build: "npm run build",
    start: "node dist/index.js",
    volumeMounts: {
      "/app/data": data,
    },
  });

  return project("trackity-server", {
    resources: [web],
  });
});
