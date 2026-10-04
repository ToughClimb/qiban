module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "Qiban",
    icon: "build/qiban.ico",
    win32metadata: {
      CompanyName: "Qiban contributors",
      FileDescription: "栖伴 Qiban",
      ProductName: "栖伴 Qiban",
    },
    ignore: (path) =>
      path !== "" && !/^\/(desktop-build($|\/)|package\.json$)/.test(path),
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: { name: "qiban", setupExe: "Qiban-Setup.exe", noMsi: true },
    },
    { name: "@electron-forge/maker-zip", platforms: ["win32"], config: {} },
  ],
};
