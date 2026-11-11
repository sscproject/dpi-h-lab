// Countries and territories a team can represent (Team step), by ISO 3166-1 alpha-3 code.
// Codes never change, so dashboards group by code, not by the name a team typed.
// Names are UN-style short names; uninhabited territories are left out.

import type { Worksheet } from './worksheet.js';

const LIST = `AFG Afghanistan|ALA Åland Islands|ALB Albania|DZA Algeria|ASM American Samoa|AND Andorra|AGO Angola|AIA Anguilla|ATG Antigua and Barbuda|ARG Argentina|ARM Armenia|ABW Aruba|AUS Australia|AUT Austria|AZE Azerbaijan|BHS Bahamas|BHR Bahrain|BGD Bangladesh|BRB Barbados|BLR Belarus|BEL Belgium|BLZ Belize|BEN Benin|BMU Bermuda|BTN Bhutan|BOL Bolivia|BES Bonaire, Sint Eustatius and Saba|BIH Bosnia and Herzegovina|BWA Botswana|BRA Brazil|VGB British Virgin Islands|BRN Brunei Darussalam|BGR Bulgaria|BFA Burkina Faso|BDI Burundi|CPV Cabo Verde|KHM Cambodia|CMR Cameroon|CAN Canada|CYM Cayman Islands|CAF Central African Republic|TCD Chad|CHL Chile|CHN China|CXR Christmas Island|CCK Cocos (Keeling) Islands|COL Colombia|COM Comoros|COG Congo|COK Cook Islands|CRI Costa Rica|CIV Côte d'Ivoire|HRV Croatia|CUB Cuba|CUW Curaçao|CYP Cyprus|CZE Czechia|PRK Democratic People's Republic of Korea|COD Democratic Republic of the Congo|DNK Denmark|DJI Djibouti|DMA Dominica|DOM Dominican Republic|ECU Ecuador|EGY Egypt|SLV El Salvador|GNQ Equatorial Guinea|ERI Eritrea|EST Estonia|SWZ Eswatini|ETH Ethiopia|FLK Falkland Islands (Malvinas)|FRO Faroe Islands|FJI Fiji|FIN Finland|FRA France|GUF French Guiana|PYF French Polynesia|GAB Gabon|GMB Gambia|GEO Georgia|DEU Germany|GHA Ghana|GIB Gibraltar|GRC Greece|GRL Greenland|GRD Grenada|GLP Guadeloupe|GUM Guam|GTM Guatemala|GGY Guernsey|GIN Guinea|GNB Guinea-Bissau|GUY Guyana|HTI Haiti|VAT Holy See|HND Honduras|HKG Hong Kong (China)|HUN Hungary|ISL Iceland|IND India|IDN Indonesia|IRN Iran|IRQ Iraq|IRL Ireland|IMN Isle of Man|ISR Israel|ITA Italy|JAM Jamaica|JPN Japan|JEY Jersey|JOR Jordan|KAZ Kazakhstan|KEN Kenya|KIR Kiribati|KWT Kuwait|KGZ Kyrgyzstan|LAO Lao People's Democratic Republic|LVA Latvia|LBN Lebanon|LSO Lesotho|LBR Liberia|LBY Libya|LIE Liechtenstein|LTU Lithuania|LUX Luxembourg|MAC Macao (China)|MDG Madagascar|MWI Malawi|MYS Malaysia|MDV Maldives|MLI Mali|MLT Malta|MHL Marshall Islands|MTQ Martinique|MRT Mauritania|MUS Mauritius|MYT Mayotte|MEX Mexico|FSM Micronesia (Federated States of)|MDA Moldova|MCO Monaco|MNG Mongolia|MNE Montenegro|MSR Montserrat|MAR Morocco|MOZ Mozambique|MMR Myanmar|NAM Namibia|NRU Nauru|NPL Nepal|NLD Netherlands|NCL New Caledonia|NZL New Zealand|NIC Nicaragua|NER Niger|NGA Nigeria|NIU Niue|NFK Norfolk Island|MKD North Macedonia|MNP Northern Mariana Islands|NOR Norway|OMN Oman|PAK Pakistan|PLW Palau|PSE Palestine|PAN Panama|PNG Papua New Guinea|PRY Paraguay|PER Peru|PHL Philippines|PCN Pitcairn|POL Poland|PRT Portugal|PRI Puerto Rico|QAT Qatar|KOR Republic of Korea|REU Réunion|ROU Romania|RUS Russian Federation|RWA Rwanda|BLM Saint Barthélemy|SHN Saint Helena, Ascension and Tristan da Cunha|KNA Saint Kitts and Nevis|LCA Saint Lucia|MAF Saint Martin (French part)|SPM Saint Pierre and Miquelon|VCT Saint Vincent and the Grenadines|WSM Samoa|SMR San Marino|STP Sao Tome and Principe|SAU Saudi Arabia|SEN Senegal|SRB Serbia|SYC Seychelles|SLE Sierra Leone|SGP Singapore|SXM Sint Maarten (Dutch part)|SVK Slovakia|SVN Slovenia|SLB Solomon Islands|SOM Somalia|ZAF South Africa|SSD South Sudan|ESP Spain|LKA Sri Lanka|SDN Sudan|SUR Suriname|SJM Svalbard and Jan Mayen|SWE Sweden|CHE Switzerland|SYR Syrian Arab Republic|TWN Taiwan|TJK Tajikistan|TZA Tanzania|THA Thailand|TLS Timor-Leste|TGO Togo|TKL Tokelau|TON Tonga|TTO Trinidad and Tobago|TUN Tunisia|TUR Türkiye|TKM Turkmenistan|TCA Turks and Caicos Islands|TUV Tuvalu|UGA Uganda|UKR Ukraine|ARE United Arab Emirates|GBR United Kingdom|USA United States of America|VIR United States Virgin Islands|URY Uruguay|UZB Uzbekistan|VUT Vanuatu|VEN Venezuela|VNM Viet Nam|WLF Wallis and Futuna|ESH Western Sahara|YEM Yemen|ZMB Zambia|ZWE Zimbabwe`;

/** [code, name] pairs, sorted by name. */
export const COUNTRIES: readonly (readonly [string, string])[] = LIST.split('|').map((e) => [e.slice(0, 3), e.slice(4)] as const);
export const COUNTRY_CODES: readonly string[] = COUNTRIES.map(([c]) => c);
const NAMES = new Map(COUNTRIES);

export const countryName = (code: string): string => NAMES.get(code) ?? code;

/** The country a group represents (ISO code), if it ticked "We are representing a country" and chose one. */
export function representedCountry(ws: Worksheet): string | null {
  const code = ws['country.code'];
  return ws['country.rep'] === true && typeof code === 'string' && NAMES.has(code) ? code : null;
}

/** How the group is named on screens and exports: the country it represents, else its team name. */
export function teamLabel(ws: Worksheet): string {
  const code = representedCountry(ws);
  if (code) return countryName(code);
  return typeof ws.country === 'string' ? ws.country.trim() : '';
}

/** The country a typed name means, if it is exactly a country's name or code ("fiji", "FJI"). */
export function matchCountry(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const hit = COUNTRIES.find(([code, name]) => name.toLowerCase() === t || code.toLowerCase() === t);
  return hit ? hit[0] : null;
}

/** Worksheet fields that mark a team as representing a country. */
export const countryFields = (code: string): Worksheet => ({ 'country.rep': true, 'country.code': code });
