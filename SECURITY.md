# Tietoturvakäytäntö

## Tuetut versiot

| Versio | Tuki |
|--------|------|
| 1.0.x  | ✅   |

## Haavoittuvuuden ilmoittaminen

**Älä ilmoita tietoturvahaavoittuvuuksia julkisena issuena.**

Ilmoita haavoittuvuuksista yksityisesti GitHubin kautta:
https://github.com/Markku-hur/easor-raportti/security/advisories/new

Sisällytä ilmoitukseen:

- Kuvaus haavoittuvuudesta
- Ohjeet toistamiseen
- Mahdollinen vaikutus

Pyrimme vastaamaan ilmoituksiin 7 päivän kuluessa ja julkaisemaan korjauksen 30 päivän kuluessa.

## Turvallisuushuomiot

- MCP-palvelin toimii vain paikallisesti — se ei avaa verkkoyhteyksiä ulospäin eikä kuuntele portteja.
- Palvelin on lukuoikeudet: se ei voi muuttaa Easorin dataa.
- `.env`-tiedosto sisältää API-tunnukset. Älä jaa sitä, committoi sitä versionhallintaan tai lähetä sitä muille.
- Raporttisivu toimii vain Claude-työpöytäsovelluksessa — sitä ei voi avata suoraan selaimessa tuotantokäytössä.
