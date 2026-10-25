/**
 * electron-builder afterPack hook: writes the icon and version information
 * into Sendix.exe.
 *
 * electron-builder's own step for this (signAndEditExecutable) runs right
 * after the fuses are flipped, and on some Windows machines it fails with
 * "UNKNOWN: unknown error, open …Sendix.exe": the file is briefly locked by
 * whatever scans freshly written executables. Here the edit happens a step
 * earlier (after the asar integrity resource, before the fuses) and is
 * retried while the file stays locked.
 */
const path = require("node:path");
const { editWindowsResources } = require("app-builder-lib/out/util/resEdit");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const { appInfo } = context.packager;
  const file = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const version = appInfo.version;
  const numeric = `${version.replace(/[-+].*$/, "")}.0`;
  const opts = {
    file,
    fileVersion: numeric,
    productVersion: version,
    iconPath: path.join(context.packager.info.projectDir, "build", "icon.ico"),
    versionStrings: {
      FileDescription: appInfo.productName,
      ProductName: appInfo.productName,
      CompanyName: "protohub.digital",
      LegalCopyright: appInfo.copyright,
      InternalName: appInfo.productFilename,
      OriginalFilename: `${appInfo.productFilename}.exe`,
    },
  };
  for (let attempt = 1; ; attempt++) {
    try {
      await editWindowsResources(opts);
      console.log(`  • Sendix.exe: icon and version ${version} written (attempt ${attempt})`);
      return;
    } catch (err) {
      if (attempt >= 15) throw err;
      await sleep(1000);
    }
  }
};
