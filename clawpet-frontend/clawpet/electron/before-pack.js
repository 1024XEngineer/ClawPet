const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function statSafe(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function latestMtimeMs(targetPath) {
  const stat = statSafe(targetPath);
  if (!stat) {
    return 0;
  }

  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  let latest = stat.mtimeMs;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    latest = Math.max(latest, latestMtimeMs(path.join(targetPath, entry.name)));
  }
  return latest;
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function copyIfDifferent(fromPath, toPath) {
  const fromStat = statSafe(fromPath);
  if (!fromStat) {
    throw new Error(`missing source binary: ${fromPath}`);
  }

  const toStat = statSafe(toPath);
  if (
    toStat &&
    toStat.size === fromStat.size &&
    Math.abs(toStat.mtimeMs - fromStat.mtimeMs) < 1
  ) {
    return false;
  }

  ensureDir(path.dirname(toPath));
  fs.copyFileSync(fromPath, toPath);
  fs.utimesSync(toPath, fromStat.atime, fromStat.mtime);
  return true;
}

function resolveExistingBinary(distDir, candidateNames) {
  for (const name of candidateNames) {
    const fullPath = path.join(distDir, name);
    if (statSafe(fullPath)) {
      return { fullPath, name };
    }
  }
  return {
    fullPath: path.join(distDir, candidateNames[0]),
    name: candidateNames[0],
  };
}

function buildBinary(repoRoot, outputPath, target) {
  ensureDir(path.dirname(outputPath));
  execFileSync(
    "go",
    ["build", "-tags", "goolm,stdjson", "-o", outputPath, target],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );
}

module.exports = async function beforePack() {
  if (process.platform !== "win32") {
    console.log("[beforePack] skipping embedded backend sync on non-Windows host");
    return;
  }

  const projectDir = path.resolve(__dirname, "..");
  const repoRoot = path.resolve(projectDir, "..", "..");
  const distDir = path.join(repoRoot, "dist");

  const sharedSourceMtime = Math.max(
    latestMtimeMs(path.join(repoRoot, "pkg")),
    latestMtimeMs(path.join(repoRoot, "go.mod")),
    latestMtimeMs(path.join(repoRoot, "go.sum")),
  );

  const binaries = [
    {
      label: "gateway",
      outputName: "picoclaw.exe",
      sourceNames: ["picoclaw.exe", "clawpet.exe"],
      buildTarget: "./cmd/picoclaw",
      sourceMtime: Math.max(
        sharedSourceMtime,
        latestMtimeMs(path.join(repoRoot, "cmd", "picoclaw")),
      ),
    },
    {
      label: "launcher",
      outputName: "picoclaw-web.exe",
      sourceNames: ["picoclaw-web.exe", "clawpet-web.exe"],
      buildTarget: "./web/backend",
      sourceMtime: Math.max(
        sharedSourceMtime,
        latestMtimeMs(path.join(repoRoot, "web", "backend")),
      ),
    },
  ];

  for (const binary of binaries) {
    const distBinary = resolveExistingBinary(distDir, binary.sourceNames || [binary.outputName]);
    const distBinaryPath = distBinary.fullPath;
    const embeddedBinaryPath = path.join(projectDir, binary.outputName);

    const distStat = statSafe(distBinaryPath);
    const embeddedStat = statSafe(embeddedBinaryPath);
    const newestBuiltMtime = Math.max(
      distStat?.mtimeMs || 0,
      embeddedStat?.mtimeMs || 0,
    );

    if (newestBuiltMtime < binary.sourceMtime) {
      console.log(`[beforePack] rebuilding ${binary.label}: ${binary.outputName}`);
      try {
        buildBinary(repoRoot, distBinaryPath, binary.buildTarget);
      } catch (err) {
        console.warn(`[beforePack] failed to rebuild ${binary.label}: ${err.message}`);
        console.warn(`[beforePack] skipping ${binary.label}, using existing binary if available`);
      }
    }

    const copied = copyIfDifferent(distBinaryPath, embeddedBinaryPath);
    if (copied) {
      console.log(
        `[beforePack] synced ${distBinary.name} into Electron resources as ${binary.outputName}`,
      );
    } else {
      console.log(`[beforePack] ${binary.outputName} already up to date`);
    }
  }
};
