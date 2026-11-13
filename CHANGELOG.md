# Muutoshistoria

Kaikki merkittävät muutokset dokumentoidaan tähän tiedostoon.

## [1.0.0] – 2026-11-13

### Lisätty

- Yritys-combo: hakukelpoinen dropdown `list_configured_organizations`-työkalusta
- Tuloslaskelma vertailuineen, tase ja kuukausikehityskaaviot
- **MYYNTIKATE** ja **KÄYTTÖKATE** välisummarivit kateprosentteineen
- Käyttökate-KPI-kortti
- Tiliporautuminen: tuloslaskelmarivi → tilit → viennit → tosite-PDF modaalissa
- **Tase-porautuminen**: tase-rivi → tilit → viennit → tosite-PDF
- **Tosite-PDF piirretään canvakselle** pdf.js 3.11.174:llä – toimii artefaktin sandbox-kehyksessä (ei enää tyhjä iframe)
- Kustannuspaikkakohtainen tuloslaskelma porautumisella
- Seurantakohderajaus (kustannuspaikka, projekti jne.)
- Myyntilaskuosio: kuukausikehitys, tilat, erääntyneet
- MIT-lisenssi
- `CONTRIBUTING.md` – osallistumisohje
- `CODE_OF_CONDUCT.md` – käytännesäännöt
- `SECURITY.md` – tietoturvakäytäntö
- `.github/PULL_REQUEST_TEMPLATE.md` – pull request -pohja
- `.github/ISSUE_TEMPLATE/` – issue-pohjat (bugraportti ja ominaisuuspyyntö)
- `.github/workflows/ci.yml` – CI-workflow (build + testit Node 20 ja 22)
- `.github/dependabot.yml` – Dependabot viikoittaiset npm-päivitykset
