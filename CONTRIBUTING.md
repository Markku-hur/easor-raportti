# Osallistumisohje

Kiitos kiinnostuksestasi! Tässä ohjeet muutosten tekemiseen.

## Kehitysympäristö

```sh
git clone https://github.com/Markku-hur/easor-raportti.git
cd easor-raportti
npm ci
cp .env.example .env   # täytä tunnukset
npm run build
```

Windows (PowerShell):

```powershell
git clone https://github.com/Markku-hur/easor-raportti.git
cd easor-raportti
npm ci
Copy-Item .env.example .env   # täytä tunnukset
npm run build
```

## Testaus

```sh
EASOR_TEST_ORG=<organisaationumero> npm test
```

Windows (PowerShell):

```powershell
$env:EASOR_TEST_ORG="<organisaationumero>"; npm test
```

Ilman organisaationumeroa testit tarkistavat vain palvelimen rakenteen eivätkä kutsu Easoria.

## Muutosten tekeminen

1. Tee oma haara (`git checkout -b ominaisuus/kuvaus`).
2. Tee muutokset ja testaa ne.
3. Committoi selkeällä viestillä englanniksi tai suomeksi.
4. Avaa pull request ja kuvaile muutos lyhyesti.

## Käytännöt

- Älä committoi `.env`-tiedostoa tai muita tunnuksia.
- Pidä MCP-palvelin lukuoikeuksisena — älä lisää työkaluja, jotka muuttavat Easorin dataa.
- Päivitä `CHANGELOG.md` uusista ominaisuuksista ja bugikorjauksista.
- Raporttisivu (`raportti/easor-talousraportti.html`) on yksittäinen HTML-tiedosto ilman build-vaihetta — pidä se sellaisena.

## Bugiraportit ja ideat

Avaa issue GitHubissa: https://github.com/Markku-hur/easor-raportti/issues
