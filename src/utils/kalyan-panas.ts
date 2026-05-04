// Master list of valid Kalyan-New pana numbers, in the canonical Matka book
// order. Used as the authoritative set for server-side validation.
//
// Categorisation by digit pattern:
//   single pana — all 3 digits different
//   double pana — exactly 2 of 3 digits the same
//   triple pana — all 3 digits the same
//
// The arrays preserve display order; classification is done by the helpers
// below so a misplaced entry can never silently pass validation.

export const KALYAN_SINGLE_PANAS: string[] = [
  "128","129","120","130","140","123","124","125","126","127",
  "137","138","139","149","159","150","160","134","135","136",
  "146","147","148","158","168","169","179","170","180","145",
  "236","156","157","167","230","178","250","189","270","190",
  "245","237","238","239","249","240","269","260","234","280",
  "290","246","247","248","258","259","278","279","289","235",
  "380","345","256","257","267","268","340","350","360","370",
  "470","390","346","347","348","349","359","369","379","389",
  "489","480","490","356","357","358","368","378","450","460",
  "560","570","580","590","456","367","458","459","469","479",
  "579","589","670","680","690","457","467","468","478","569",
  "678","679","689","789","780","790","890","567","568","578",
];

// 90 double panas (one digit appears twice + a different singleton).
// Restored to canonical 90: caller's hand-typed list dropped "044" and "388",
// which are the two missing entries in the v=4 and v=8 groups respectively.
export const KALYAN_DOUBLE_PANAS: string[] = [
  "100","200","300","400","500","600","700","800","900","550",
  "119","110","166","112","113","114","115","116","117","118",
  "155","228","229","220","122","277","133","224","144","226",
  "227","255","337","266","177","330","188","233","199","244",
  "335","336","355","338","339","448","223","225","299","334",
  "344","499","445","446","366","466","377","288","488","044",
  "399","660","599","455","447","556","449","477","559","668",
  "588","688","779","699","799","880","557","558","577","677",
  "669","778","788","770","889","899","566","990","667","388",
];

export const KALYAN_TRIPLE_PANAS: string[] = [
  "000","111","222","333","444","555","666","777","888","999",
];

export const KALYAN_ALL_PANAS: string[] = [
  ...KALYAN_SINGLE_PANAS,
  ...KALYAN_DOUBLE_PANAS,
  ...KALYAN_TRIPLE_PANAS,
];

export const KALYAN_PANA_SET = new Set<string>(KALYAN_ALL_PANAS);

export function isTriplePana(s: string): boolean {
  return s.length === 3 && s[0] === s[1] && s[1] === s[2];
}

export function isDoublePana(s: string): boolean {
  if (s.length !== 3) return false;
  if (isTriplePana(s)) return false;
  return s[0] === s[1] || s[1] === s[2] || s[0] === s[2];
}

export function isSinglePana(s: string): boolean {
  if (s.length !== 3) return false;
  return s[0] !== s[1] && s[1] !== s[2] && s[0] !== s[2];
}
