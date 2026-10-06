import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const data = volume("server-data", { sizeMB: 1024 });

  const web = service("trackity-server", {
    source: github("Ahsoka211/trackity", { branch: "main", rootDirectory: "server" }),
    build: { builder: "DOCKERFILE" },
    deploy: { sleepApplication: true },
    env: {
      HENRIK_API_KEY: preserve(),
    },
  });

  return project("trackity-server", {
    resources: [web],
  });
});
