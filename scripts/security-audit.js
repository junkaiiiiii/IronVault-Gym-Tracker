const { spawnSync } = require("child_process");

const ALLOWED_IMAGE_SIZE_ADVISORIES = new Set([
  "https://github.com/advisories/GHSA-5p2g-fcmc-qvqq",
  "https://github.com/advisories/GHSA-w3rx-r6r6-pgpr",
]);

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});

if (result.error) {
  console.error("Unable to run npm audit:", result.error.message);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout || "{}");
} catch {
  console.error("npm audit returned an unreadable response.");
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(1);
}

if (report.error) {
  console.error("npm audit could not complete:", report.error.summary || report.error);
  process.exit(1);
}

const unexpected = Object.entries(report.vulnerabilities || {}).filter(
  ([name, finding]) => {
    if (name !== "image-size" || finding?.severity !== "high") return true;

    const advisoryUrls = (Array.isArray(finding.via) ? finding.via : [])
      .filter((item) => item && typeof item === "object")
      .map((item) => item.url)
      .filter(Boolean);

    return (
      advisoryUrls.length !== ALLOWED_IMAGE_SIZE_ADVISORIES.size ||
      advisoryUrls.some((url) => !ALLOWED_IMAGE_SIZE_ADVISORIES.has(url))
    );
  },
);

if (unexpected.length > 0) {
  console.error("Unexpected production dependency vulnerabilities found:");
  unexpected.forEach(([name, finding]) => {
    console.error(`- ${name}: ${finding.severity}`);
  });
  process.exit(1);
}

const total = report.metadata?.vulnerabilities?.total || 0;
if (total > 0) {
  console.log(
    "Only the documented Metro image-size build-time advisories remain.",
  );
} else {
  console.log("No production dependency vulnerabilities found.");
}
