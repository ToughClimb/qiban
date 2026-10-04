module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "Qiban",
    icon: "build/qiban.ico",
    extraResource: ["desktop-build/THIRD_PARTY_NOTICES.txt"],
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
      config: {
        name: "qiban", setupExe: "Qiban-Setup.exe", noMsi: true,
        // Squirrel's default NuGet template includes LICENSE but omits HTML notices.
        additionalFiles: [{ src: "LICENSES.chromium.html", target: "lib\\net45\\LICENSES.chromium.html" }],
      },
    },
    { name: "@electron-forge/maker-zip", platforms: ["win32"], config: {} },
  ],
};
