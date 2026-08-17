// Predefined dynamic `$variables` ({{$guid}}, {{$timestamp}}, …).
// TypeScript port of the Tropel `DynamicCatalog` (crates/tropel-variables) so
// the browser app resolves the same catalog with identical spellings and
// semantics: a fresh value per occurrence, `:length`/`:count` arguments capped
// to MAX_DYNAMIC_LENGTH, and unknown `{{$…}}` names left as literal
// placeholders.

export const MAX_DYNAMIC_LENGTH = 10_000;

const UNKNOWN_WARNED = new Set<string>();

const UUID_CHARS = "0123456789abcdef";

function uuidv4(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  let uuid = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) uuid += "-";
    else if (i === 14) uuid += "4";
    else if (i === 19) uuid += UUID_CHARS.charAt(8 + Math.floor(Math.random() * 4));
    else uuid += UUID_CHARS.charAt(Math.floor(Math.random() * UUID_CHARS.length));
  }
  return uuid;
}

function randInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function randRange(min: number, maxExclusive: number): number {
  return min + Math.floor(Math.random() * (maxExclusive - min));
}

function pick<T>(items: readonly T[]): T {
  return items[randInt(items.length)];
}

function randomString(length: number, charset: string): string {
  let out = "";
  for (let i = 0; i < length; i++) out += charset.charAt(randInt(charset.length));
  return out;
}

const ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ALPHANUMERIC = `${ALPHA}0123456789`;
const PASSWORD_CHARS = `${ALPHANUMERIC}!@#$%^&*`;
const HEX_CHARS = "0123456789abcdef";

function cappedLen(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return MAX_DYNAMIC_LENGTH;
  return Math.min(n, MAX_DYNAMIC_LENGTH);
}

function capitalize(text: string): string {
  if (!text) return text;
  return text[0].toUpperCase() + text.slice(1);
}

const FIRST_NAMES = [
  "Ava",
  "Liam",
  "Noah",
  "Emma",
  "Olivia",
  "Elijah",
  "Sophia",
  "Mia",
  "Charlotte",
  "Amelia",
  "James",
  "Benjamin",
  "Lucas",
  "Ethan",
  "Harper",
  "Evelyn",
  "Abigail",
  "William",
  "Henry",
  "Ella",
];

const LAST_NAMES = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Hernandez",
  "Lopez",
  "Gonzalez",
  "Wilson",
  "Anderson",
  "Thomas",
  "Taylor",
  "Moore",
  "Jackson",
  "Martin",
];

const COMPANY_NAMES = [
  "Acme Corporation",
  "Globex Corporation",
  "Initech",
  "Stark Industries",
  "Wayne Enterprises",
  "Umbrella Corporation",
  "Cyberdyne Systems",
  "Massive Dynamic",
  "Wonka Industries",
  "Blue Origin",
  "Aperture Labs",
  "Pioneer Logistics",
  "Evergreen Technologies",
  "TrueNorth Consulting",
  "Redwood Analytics",
  "Summit Systems",
  "Liberty Software",
  "Silverline Media",
  "Veridian Dynamics",
  "Northstar Financial",
];

const CITY_NAMES = [
  "New York",
  "London",
  "Paris",
  "Tokyo",
  "Berlin",
  "Sydney",
  "Toronto",
  "San Francisco",
  "Chicago",
  "Barcelona",
  "Amsterdam",
  "Singapore",
  "Dubai",
  "Los Angeles",
  "Seattle",
  "Dublin",
  "Vienna",
  "Cape Town",
  "Mumbai",
  "Helsinki",
];

const COUNTRY_NAMES = [
  "United States",
  "Canada",
  "United Kingdom",
  "Australia",
  "Germany",
  "France",
  "Japan",
  "Spain",
  "Italy",
  "Netherlands",
  "Sweden",
  "Norway",
  "Brazil",
  "Mexico",
  "India",
  "Singapore",
  "South Africa",
  "Switzerland",
  "Austria",
  "Ireland",
];

const STREET_NAMES = [
  "Maple",
  "Oak",
  "Pine",
  "Cedar",
  "Elm",
  "Walnut",
  "Chestnut",
  "Birch",
  "Willow",
  "Aspen",
  "Sunset",
  "River",
  "Hill",
  "Grove",
  "Park",
  "Meadow",
  "Lake",
  "Forest",
  "Jackson",
  "Lincoln",
];

const STREET_SUFFIXES = [
  "Street",
  "Avenue",
  "Boulevard",
  "Lane",
  "Drive",
  "Court",
  "Place",
  "Terrace",
  "Way",
  "Row",
];

const EMAIL_DOMAINS = [
  "example.com",
  "example.org",
  "mail.com",
  "test.com",
  "acme.com",
  "globex.com",
  "true-north.com",
  "evergreen.io",
];

const LOREM_WORDS = [
  "lorem",
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "consectetur",
  "adipiscing",
  "elit",
  "sed",
  "do",
  "eiusmod",
  "tempor",
  "incididunt",
  "ut",
  "labore",
  "et",
  "dolore",
  "magna",
  "aliqua",
  "enim",
  "ad",
  "minim",
  "veniam",
  "quis",
  "nostrud",
  "exercitation",
  "ullamco",
  "laboris",
  "nisi",
  "ut",
];

const COLOR_NAMES = [
  "red",
  "green",
  "blue",
  "yellow",
  "purple",
  "mint green",
  "teal",
  "white",
  "black",
  "orange",
  "pink",
  "grey",
  "maroon",
  "violet",
  "turquoise",
  "tan",
  "sky blue",
  "salmon",
  "plum",
  "orchid",
  "olive",
  "magenta",
  "lime",
  "ivory",
  "indigo",
  "gold",
  "fuchsia",
  "cyan",
  "azure",
  "beige",
  "brown",
  "crimson",
  "lavender",
  "silver",
  "wheat",
  "coral",
  "navy",
  "khaki",
  "aqua",
  "chocolate",
  "dark blue",
  "light green",
  "peach",
  "peru",
  "sienna",
  "tomato",
  "violet red",
  "spring green",
  "royal blue",
  "rebecca purple",
];

const ABBREVIATIONS = ["SQL", "PCI", "JSON", "HTML", "CSS", "JS", "TS", "API"];

const LOCALES = ["ny", "sr", "si"];

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10.9.8; rv:15.6) Gecko/20100101 Firefox/15.6.6",
  "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:15.6) Gecko/20100101 Firefox/15.6.6",
  "Mozilla/5.0 (X11; Linux x86_64; rv:15.6) Gecko/20100101 Firefox/15.6.6",
];

const NAME_PREFIXES = ["Dr.", "Ms.", "Mr.", "Mrs.", "Miss", "Prof."];

const NAME_SUFFIXES = ["I", "MD", "DDS", "PhD", "Esq.", "Jr."];

const JOB_AREAS = ["Mobility", "Intranet", "Configuration", "Development", "Design", "Testing"];

const JOB_DESCRIPTORS = ["Forward", "Corporate", "Senior", "Junior", "Lead", "Principal"];

const JOB_TITLES = [
  "International Creative Liaison",
  "Global Branding Officer",
  "Dynamic Data Specialist",
  "Internal Communications Consultant",
  "Productivity Analyst",
  "Regional Applications Developer",
];

const JOB_TYPES = ["Supervisor", "Manager", "Coordinator", "Director"];

function randomWord(): string {
  return pick(LOREM_WORDS);
}

function randomWords(count: number): string {
  const words: string[] = [];
  for (let i = 0; i < count; i++) words.push(pick(LOREM_WORDS));
  return words.join(" ");
}

function randomSentence(): string {
  return `${capitalize(randomWords(randRange(5, 12)))}.`;
}

function randomLoremParagraph(): string {
  const sentences: string[] = [];
  for (let i = 0; i < randRange(2, 5); i++) sentences.push(randomSentence());
  return sentences.join(" ");
}

function randomEmail(): string {
  const first = pick(FIRST_NAMES).toLowerCase();
  const last = pick(LAST_NAMES).toLowerCase();
  const domain = pick(EMAIL_DOMAINS);
  switch (randInt(3)) {
    case 1:
      return `${first}.${last}@${domain}`;
    case 2:
      return `${first}${randRange(1, 100)}@${domain}`;
    default:
      return `${first}@${domain}`;
  }
}

function randomPhoneNumber(): string {
  return `(${randRange(200, 999)}) ${randRange(200, 999)}-${randRange(1000, 10000)}`;
}

function randomStreet(): string {
  return `${randRange(100, 9999)} ${pick(STREET_NAMES)} ${pick(STREET_SUFFIXES)}`;
}

function randomMacAddress(): string {
  const octets: string[] = [];
  for (let i = 0; i < 6; i++) {
    octets.push(randInt(256).toString(16).padStart(2, "0"));
  }
  return octets.join(":");
}

function randomIPv6(): string {
  const groups: string[] = [];
  for (let i = 0; i < 8; i++) {
    groups.push(randInt(65536).toString(16).padStart(4, "0"));
  }
  return groups.join(":");
}

function randomDateInRange(start: Date, end: Date): string {
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
  const offset = days <= 0 ? 0 : randInt(days + 1);
  return new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

function randomDate(): string {
  return randomDateInRange(new Date(Date.UTC(1990, 0, 1)), new Date(Date.UTC(2035, 11, 31)));
}

function randomDatePast(): string {
  const now = new Date();
  return randomDateInRange(new Date(now.getTime() - 3650 * 86_400_000), now);
}

function randomDateFuture(): string {
  const now = new Date();
  return randomDateInRange(now, new Date(now.getTime() + 3650 * 86_400_000));
}

function randomTime(): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(randInt(24))}:${pad(randInt(60))}:${pad(randInt(60))}`;
}

/**
 * Resolve every predefined dynamic variable in `input`.
 * Each occurrence generates a fresh value, matching Postman/Tropel semantics.
 * Unknown `{{$…}}` names survive as literal placeholders (and warn once).
 */
export function resolvePredefinedVariables(input: string): string {
  if (!input.includes("{{$")) return input;
  let r = input;

  if (r.includes("{{$guid}}")) r = r.replace(/\{\{\$guid\}\}/g, uuidv4);
  if (r.includes("{{$timestamp}}")) {
    r = r.replace(/\{\{\$timestamp\}\}/g, () => Math.floor(Date.now() / 1000).toString());
  }
  if (r.includes("{{$isoTimestamp}}")) {
    r = r.replace(/\{\{\$isoTimestamp\}\}/g, () => new Date().toISOString());
  }
  if (r.includes("{{$randomUUID}}")) r = r.replace(/\{\{\$randomUUID\}\}/g, uuidv4);
  if (r.includes("{{$randomInt}}"))
    r = r.replace(/\{\{\$randomInt\}\}/g, () => randInt(1000).toString());
  if (r.includes("{{$randomFloat}}")) {
    r = r.replace(/\{\{\$randomFloat\}\}/g, () => (Math.random() * 1000).toFixed(6));
  }
  if (r.includes("{{$randomString")) {
    r = r.replace(/\{\{\$randomString(?::(\d+))?\}\}/g, (_m, len) =>
      randomString(cappedLen(len, 10), ALPHANUMERIC),
    );
  }
  if (r.includes("{{$randomAlphabetic")) {
    r = r.replace(/\{\{\$randomAlphabetic(?::(\d+))?\}\}/g, (_m, len) =>
      randomString(cappedLen(len, 10), ALPHA),
    );
  }
  // Postman's spelling is $randomAlphaNumeric; the Alphanumeric misspelling is
  // kept as a resolving alias (Tropel W2 #199).
  if (r.includes("{{$randomAlphaNumeric") || r.includes("{{$randomAlphanumeric")) {
    r = r.replace(/\{\{\$random(?:AlphaNumeric|Alphanumeric)(?::(\d+))?\}\}/g, (_m, len) =>
      randomString(cappedLen(len, 10), ALPHANUMERIC),
    );
  }
  if (r.includes("{{$randomBoolean}}")) {
    r = r.replace(/\{\{\$randomBoolean\}\}/g, () => (Math.random() < 0.5 ? "true" : "false"));
  }
  // $randomHexColor BEFORE $randomHex — the latter's gate would otherwise fire
  // on the shared prefix.
  if (r.includes("{{$randomHexColor}}")) {
    r = r.replace(/\{\{\$randomHexColor\}\}/g, () => `#${randomString(6, HEX_CHARS)}`);
  }
  if (r.includes("{{$randomHex")) {
    r = r.replace(/\{\{\$randomHex(?::(\d+))?\}\}/g, (_m, len) =>
      randomString(cappedLen(len, 8), HEX_CHARS),
    );
  }
  if (r.includes("{{$randomEmail}}")) r = r.replace(/\{\{\$randomEmail\}\}/g, randomEmail);
  if (r.includes("{{$randomPhone")) {
    r = r.replace(/\{\{\$randomPhone(?:Number)?\}\}/g, randomPhoneNumber);
  }
  if (r.includes("{{$randomCompany")) {
    r = r.replace(/\{\{\$randomCompany(?:Name)?\}\}/g, () => pick(COMPANY_NAMES));
  }
  // Postman's spelling is $randomLoremText / $randomLoremSentence; the
  // shorter forms are kept as resolving aliases (Tropel W2 #199).
  if (r.includes("{{$randomLoremText}}") || r.includes("{{$randomLorem}}")) {
    r = r.replace(/\{\{\$random(?:LoremText|Lorem)\}\}/g, randomLoremParagraph);
  }
  if (r.includes("{{$randomLoremSentence}}") || r.includes("{{$randomSentence}}")) {
    r = r.replace(/\{\{\$random(?:Lorem)?Sentence\}\}/g, randomSentence);
  }
  if (r.includes("{{$randomWords")) {
    r = r.replace(/\{\{\$randomWords(?::(\d+))?\}\}/g, (_m, count) =>
      randomWords(cappedLen(count, 5)),
    );
  }
  if (r.includes("{{$randomWord}}")) r = r.replace(/\{\{\$randomWord\}\}/g, randomWord);
  if (r.includes("{{$randomDatePast}}")) r = r.replace(/\{\{\$randomDatePast\}\}/g, randomDatePast);
  if (r.includes("{{$randomDateFuture}}"))
    r = r.replace(/\{\{\$randomDateFuture\}\}/g, randomDateFuture);
  if (r.includes("{{$randomDate}}")) r = r.replace(/\{\{\$randomDate\}\}/g, randomDate);
  if (r.includes("{{$randomTime}}")) r = r.replace(/\{\{\$randomTime\}\}/g, randomTime);
  if (r.includes("{{$randomIPV6}}")) r = r.replace(/\{\{\$randomIPV6\}\}/g, randomIPv6);
  if (r.includes("{{$randomIP}}")) {
    r = r.replace(
      /\{\{\$randomIP\}\}/g,
      () => `${randRange(1, 255)}.${randRange(0, 255)}.${randRange(0, 255)}.${randRange(1, 255)}`,
    );
  }
  if (r.includes("{{$randomCity}}")) r = r.replace(/\{\{\$randomCity\}\}/g, () => pick(CITY_NAMES));
  if (r.includes("{{$randomCountry}}"))
    r = r.replace(/\{\{\$randomCountry\}\}/g, () => pick(COUNTRY_NAMES));
  if (r.includes("{{$randomStreetName}}") || r.includes("{{$randomStreet}}")) {
    r = r.replace(/\{\{\$random(?:StreetName|Street)\}\}/g, randomStreet);
  }
  if (r.includes("{{$randomPostcode}}")) {
    r = r.replace(/\{\{\$randomPostcode\}\}/g, () =>
      String(randRange(10000, 100000)).padStart(5, "0"),
    );
  }
  if (r.includes("{{$randomName}}")) {
    r = r.replace(/\{\{\$randomName\}\}/g, () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`);
  }
  if (r.includes("{{$randomNameFullName}}") || r.includes("{{$randomFullName}}")) {
    r = r.replace(
      /\{\{\$random(?:Name)?FullName\}\}/g,
      () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    );
  }
  if (r.includes("{{$randomNameFirstName}}") || r.includes("{{$randomFirstName}}")) {
    r = r.replace(/\{\{\$random(?:Name)?FirstName\}\}/g, () => pick(FIRST_NAMES));
  }
  if (r.includes("{{$randomNameLastName}}") || r.includes("{{$randomLastName}}")) {
    r = r.replace(/\{\{\$random(?:Name)?LastName\}\}/g, () => pick(LAST_NAMES));
  }
  // $randomColor is a colour WORD (faker.commerce.color), not a hex string.
  if (r.includes("{{$randomColor}}"))
    r = r.replace(/\{\{\$randomColor\}\}/g, () => pick(COLOR_NAMES));
  if (r.includes("{{$randomMACAddress}}") || r.includes("{{$randomMAC}}")) {
    r = r.replace(/\{\{\$randomMAC(?:Address)?\}\}/g, randomMacAddress);
  }
  if (r.includes("{{$randomPassword")) {
    r = r.replace(/\{\{\$randomPassword(?::(\d+))?\}\}/g, (_m, len) =>
      randomString(cappedLen(len, 12), PASSWORD_CHARS),
    );
  }
  if (r.includes("{{$randomAbbreviation}}"))
    r = r.replace(/\{\{\$randomAbbreviation\}\}/g, () => pick(ABBREVIATIONS));
  if (r.includes("{{$randomLocale}}"))
    r = r.replace(/\{\{\$randomLocale\}\}/g, () => pick(LOCALES));
  if (r.includes("{{$randomUserAgent}}"))
    r = r.replace(/\{\{\$randomUserAgent\}\}/g, () => pick(USER_AGENTS));
  if (r.includes("{{$randomProtocol}}")) {
    r = r.replace(/\{\{\$randomProtocol\}\}/g, () => (Math.random() < 0.5 ? "http" : "https"));
  }
  if (r.includes("{{$randomSemver}}")) {
    r = r.replace(/\{\{\$randomSemver\}\}/g, () => `${randInt(10)}.${randInt(10)}.${randInt(10)}`);
  }
  if (r.includes("{{$randomNamePrefix}}"))
    r = r.replace(/\{\{\$randomNamePrefix\}\}/g, () => pick(NAME_PREFIXES));
  if (r.includes("{{$randomNameSuffix}}"))
    r = r.replace(/\{\{\$randomNameSuffix\}\}/g, () => pick(NAME_SUFFIXES));
  if (r.includes("{{$randomJobArea}}"))
    r = r.replace(/\{\{\$randomJobArea\}\}/g, () => pick(JOB_AREAS));
  if (r.includes("{{$randomJobDescriptor}}")) {
    r = r.replace(/\{\{\$randomJobDescriptor\}\}/g, () => pick(JOB_DESCRIPTORS));
  }
  if (r.includes("{{$randomJobTitle}}"))
    r = r.replace(/\{\{\$randomJobTitle\}\}/g, () => pick(JOB_TITLES));
  if (r.includes("{{$randomJobType}}"))
    r = r.replace(/\{\{\$randomJobType\}\}/g, () => pick(JOB_TYPES));

  // Anything still matching {{$…}} is not in the catalog: keep it literal and
  // warn once per distinct name (Tropel backlog line 141).
  if (r.includes("{{$")) {
    for (const m of r.matchAll(/\{\{\$([A-Za-z][A-Za-z0-9_]*)(?::[^}]*)?\}\}/g)) {
      const name = m[1];
      if (!UNKNOWN_WARNED.has(name)) {
        UNKNOWN_WARNED.add(name);
        console.warn(
          `[variables] unimplemented dynamic variable: $${name} — sent as literal placeholder`,
        );
      }
    }
  }

  return r;
}

export interface PredefinedVariableInfo {
  name: string;
  description: string;
}

export const PREDEFINED_VARIABLES: readonly PredefinedVariableInfo[] = [
  { name: "$guid", description: "A v4 GUID" },
  { name: "$timestamp", description: "Current UNIX timestamp (seconds)" },
  { name: "$isoTimestamp", description: "Current ISO timestamp (UTC)" },
  { name: "$randomUUID", description: "A random v4 UUID" },
  { name: "$randomInt", description: "Random integer 0–999" },
  { name: "$randomFloat", description: "Random float 0–1000 (6 decimals)" },
  {
    name: "$randomString",
    description: "Random alphanumeric string ({{$randomString:16}} for length)",
  },
  { name: "$randomAlphabetic", description: "Random alphabetic string" },
  { name: "$randomAlphaNumeric", description: "Random alphanumeric string" },
  { name: "$randomBoolean", description: "true or false" },
  { name: "$randomHexColor", description: "Random #rrggbb colour" },
  { name: "$randomHex", description: "Random hex string ({{$randomHex:8}} for length)" },
  { name: "$randomColor", description: "Random colour name" },
  { name: "$randomEmail", description: "Random email address" },
  { name: "$randomPhone", description: "Random phone number" },
  { name: "$randomPhoneNumber", description: "Random phone number" },
  { name: "$randomCompany", description: "Random company name" },
  { name: "$randomCompanyName", description: "Random company name" },
  { name: "$randomLoremText", description: "Random lorem paragraph" },
  { name: "$randomLoremSentence", description: "Random lorem sentence" },
  { name: "$randomWord", description: "Random word" },
  { name: "$randomWords", description: "Random words ({{$randomWords:5}} for count)" },
  { name: "$randomDate", description: "Random date 1990–2035 (YYYY-MM-DD)" },
  { name: "$randomDatePast", description: "Random date in the past 10 years" },
  { name: "$randomDateFuture", description: "Random date in the next 10 years" },
  { name: "$randomTime", description: "Random HH:MM:SS time" },
  { name: "$randomIP", description: "Random IPv4 address" },
  { name: "$randomIPV6", description: "Random IPv6 address" },
  { name: "$randomMACAddress", description: "Random MAC address" },
  {
    name: "$randomPassword",
    description: "Random 12-char password ({{$randomPassword:16}} for length)",
  },
  { name: "$randomCity", description: "Random city name" },
  { name: "$randomCountry", description: "Random country name" },
  { name: "$randomStreetName", description: "Random street address" },
  { name: "$randomPostcode", description: "Random 5-digit postcode" },
  { name: "$randomName", description: "Random full name" },
  { name: "$randomFullName", description: "Random full name" },
  { name: "$randomFirstName", description: "Random first name" },
  { name: "$randomLastName", description: "Random last name" },
  { name: "$randomNamePrefix", description: "Random name prefix (Dr., Ms., …)" },
  { name: "$randomNameSuffix", description: "Random name suffix (Jr., PhD, …)" },
  { name: "$randomAbbreviation", description: "Random abbreviation (SQL, JSON, …)" },
  { name: "$randomLocale", description: "Random locale code" },
  { name: "$randomUserAgent", description: "Random user-agent string" },
  { name: "$randomProtocol", description: "http or https" },
  { name: "$randomSemver", description: "Random semver (x.y.z)" },
  { name: "$randomJobArea", description: "Random job area" },
  { name: "$randomJobDescriptor", description: "Random job descriptor" },
  { name: "$randomJobTitle", description: "Random job title" },
  { name: "$randomJobType", description: "Random job type" },
];

export const PREDEFINED_VARIABLE_NAMES: readonly string[] = PREDEFINED_VARIABLES.map((v) => v.name);
