# Easor talousraportti

Yhden asiakkaan talousraportti Claude-työpöytäsovelluksessa: tuloslaskelma, tase, vertailu edelliseen vuoteen, kuukausikehitys, myyntilaskut ja seurantakohderajaus. Luvut haetaan Easorista, kun painat *Hae luvut*.

Raporttisivu: https://claude.ai/code/artifact/a5a605ff-fd2e-41e9-8ed9-f0fad9ad2e18

Paketissa on kaksi osaa:

- **Palvelin** (tämä kansio): pieni ohjelma, joka hakee luvut Easorin rajapinnasta. Se pystyy vain lukemaan, ja se toimii vain omalla koneellasi ilman verkko-osoitetta.
- **Raporttisivu** (`raportti/`): Claude-sivu, joka näyttää luvut.

Jokainen käyttäjä tarvitsee oman asennuksen, koska toistaiseksi vain sivun omistaja voi käyttää koneellaan ajettavaa palvelinta.

## Mitä tarvitset

- Claude-tilin ja Claude-työpöytäsovelluksen.
- Claude Coden sivun julkaisuun.
- Node.js:n, versio 20 tai uudempi. Windowsissa sen saa asennettua PowerShellissä komennolla `winget install OpenJS.NodeJS.LTS`. Avaa asennuksen jälkeen uusi PowerShell-ikkuna, koska vanhat ikkunat eivät vielä löydä `node`-komentoa.
- Jokaisen raportoitavan yrityksen oman Easor-rajapinta-avaimen, joka kattaa General Ledger FI:n ja Sales Invoicing FI:n. Avaimet saa osoitteesta integration.support@easor.com. Pyydä mahdollisuuksien mukaan pelkät lukuoikeudet.

## 1. Asenna palvelin

Pura paketti pysyvään kansioon ja aja siellä:

macOS:

```sh
npm ci
npm run build
cp .env.example .env
chmod 600 .env
```

Windows (PowerShell):

```powershell
npm ci
npm run build
Copy-Item .env.example .env
notepad .env
```

Asenna paketti aina koneelle uudelleen näillä komennoilla. Älä kopioi `node_modules`- tai `dist`-kansiota toiselta koneelta, koska riippuvuuksissa on käyttöjärjestelmäkohtaisia ohjelmia.

Täytä tunnukset tiedostoon `.env`, yksi neljän rivin lohko yritystä kohden. Sama avain kelpaa sekä kirjanpitoon että myyntilaskuihin. Yritys tunnistetaan Easorin organisaationumerosta, jonka valitset myös raporttisivulla:

```
EASOR_ORG_12345_CLIENT_ID=...
EASOR_ORG_12345_CLIENT_SECRET=...
EASOR_ORG_12345_SCOPE=...
EASOR_ORG_12345_SUBSCRIPTION_KEY=...
```

Palvelin käyttää aina ensin haetun organisaation omaa avainta. Jos sitä ei ole tai Easor ei hyväksy sitä, palvelin käyttää organisaationumerottomia yhteisiä tunnuksia, jos niitä on. Muuten sivu kertoo, mitkä tunnukset puuttuvat. Vanha muoto, jossa on erilliset avaimet rajapinnoittain (`EASOR_ORG_12345_GL_FI_*` ja `EASOR_ORG_12345_SALES_FI_*`), toimii edelleen, ja kumpaakin kokeillaan tarvittaessa myös toiseen rajapintaan. Mallin näet tiedostosta `.env.example`.

`.env` on tavallinen tekstitiedosto, jossa on kaikkien yritysten tunnukset. Sitä ei saa lisätä versionhallintaan eikä lähettää muille. Kun lisäät yrityksen, käynnistä Claude uudelleen.

Tarkista asennus omalla organisaationumerollasi:

```sh
EASOR_TEST_ORG=<organisaationumero> npm test
```

Windows (PowerShell):

```powershell
$env:EASOR_TEST_ORG="<organisaationumero>"; npm test
```

Ilman organisaationumeroa testit tarkistavat vain palvelimen rakenteen, eivätkä ne kutsu Easoria.

## 2. Liitä palvelin Claude-työpöytäsovellukseen

### Helpoin tapa: komento

Aja paketin kansiossa (macOS ja Windows):

```sh
npm run setup:claude
```

Komento lisää palvelimen nimellä `easor` Claude-työpöytäsovelluksen asetuksiin ja, jos `claude`-komento on asennettu, myös Claude Codeen (kohta 3). Se etsii asetustiedoston itse, säilyttää muut asetukset ja tekee alkuperäisestä varmuuskopion `claude_desktop_config.json.bak-easor`. Jos siirrät paketin kansion myöhemmin toiseen paikkaan, aja komento uudelleen.

Lopeta sen jälkeen sovellus kokonaan ja avaa se uudelleen. Windowsissa ikkunan sulkeminen ei riitä: lopeta sovellus ilmaisinalueen kuvakkeesta (*Quit*).

### Käsin

Avaa sovelluksen asetuksista *Developer* ja *Edit Config*, tai avaa tiedosto suoraan:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: sijainti riippuu sovelluksen versiosta ja asennustavasta, joten avaa tiedosto mieluiten sovelluksen kautta. Mahdolliset paikat:
  - `%LOCALAPPDATA%\Claude-Data\claude_<tunniste>\claude_desktop_config.json` (uudet versiot)
  - `%LOCALAPPDATA%\Packages\Claude_<tunniste>\LocalCache\Roaming\Claude\claude_desktop_config.json` (Microsoft Store)
  - `%APPDATA%\Claude\claude_desktop_config.json` (vanhat versiot)

  Tiedoston löytää PowerShellissä komennolla:

  ```powershell
  Get-ChildItem $env:LOCALAPPDATA, $env:APPDATA -Recurse -Depth 5 -Filter claude_desktop_config.json -ErrorAction SilentlyContinue | Select-Object -Expand FullName
  ```

Lisää palvelin `mcpServers`-kohtaan ja käytä kokonaisia polkuja. Noden polun näet komennolla `which node` (Windowsissa `where node`).

macOS:

```json
{
  "mcpServers": {
    "easor": {
      "command": "/polku/node",
      "args": ["/polku/easor-raportti/dist/index.js"]
    }
  }
}
```

Windows: kirjoita jokainen kenoviiva tuplana, tai käytä kauttaviivoja (`C:/easor-raportti/dist/index.js`).

```json
{
  "mcpServers": {
    "easor": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\easor-raportti\\dist\\index.js"]
    }
  }
}
```

Esimerkki, kun paketti on purettu Tiedostot-kansioon (`<käyttäjä>` on Windows-käyttäjänimesi). Jos asetustiedostossa on jo muita palvelimia, lisää `easor` niiden rinnalle samaan `mcpServers`-kohtaan pilkulla erotettuna:

```json
{
  "mcpServers": {
    "easor": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Users\\<käyttäjä>\\Documents\\easor-raportti\\dist\\index.js"]
    }
  }
}
```

Saat `dist\index.js`-tiedoston koko polun ajamalla paketin kansiossa PowerShellissä:

```powershell
(Resolve-Path .\dist\index.js).Path
```

Palvelimen nimen pitää olla täsmälleen `easor`, koska raporttisivu kutsuu sitä tällä nimellä. Sulje sovellus kokonaan ja avaa se uudelleen. Windowsissa ikkunan sulkeminen ei riitä: lopeta sovellus ilmaisinalueen kuvakkeesta (*Quit*).

## 3. Julkaise raporttisivu omalle tilillesi

Julkaise sivu paikallisesta Claude Code -sessiosta, johon palvelin on kytketty, koska pilvessä toimiva keskustelu ei voi antaa sivulle oikeutta paikalliseen palvelimeen.

Jos ajoit kohdassa 2 komennon `npm run setup:claude` ja `claude` oli jo asennettu, palvelin on jo lisätty Claude Codeen. Siirry suoraan `claude`-komentoon. Muuten lisää se käsin:

```sh
claude mcp add easor -- /polku/node /polku/easor-raportti/dist/index.js
claude
```

Windows (PowerShell):

```powershell
claude mcp add easor -- "C:\Program Files\nodejs\node.exe" "C:\easor-raportti\dist\index.js"
claude
```

PowerShellissä polut kirjoitetaan lainausmerkkeihin yksinkertaisilla kenoviivoilla, ei tuplana kuten JSONissa. Voit tarkistaa ennen `claude`-komentoa, että palvelin käynnistyy: `claude mcp list` näyttää kohdan `easor` tilana *Connected*.

Pyydä sessiossa:

> Julkaise `raportti/easor-talousraportti.html` Artifactina. Anna sille tiedoston `raportti/capabilities.json` mukaiset capabilities. Älä muuta sivun sisältöä.

Sivu on oletuksena yksityinen.

## 4. Hae ensimmäinen raportti

1. Avaa sivu Claude-työpöytäsovelluksessa, ei selaimessa.
2. Valitse organisaatio ja kuukausi, johon kausi päättyy. Organisaationumeron kenttä ehdottaa yrityksiä, joille `.env`-tiedostossa on omat tunnukset, nimen ja Y-tunnuksen kanssa. Jos tunnuksia on vain yhdelle yritykselle, se valitaan valmiiksi. Muun numeron voi kirjoittaa itse, esimerkiksi jos yhteiset tunnukset kattavat yrityksen.
3. Paina *Hae luvut*.

Ensimmäinen haku kestää noin minuutin, koska Claude rajoittaa sivun kutsuja. Sama haku 5 minuutin sisällä näyttää jo haetut luvut, ja kohta *Haettu* kertoo, milloin ne on haettu.

## Päivitys vanhasta versiosta

1. Lopeta Claude-sovellus (Windowsissa ilmaisinalueen kuvakkeesta: *Quit*).
2. Pura uusi paketti vanhan kansion päälle tai uuteen kansioon. Säilytä vanha `.env`, ja kopioi se uuteen kansioon, jos vaihdoit kansiota. Vanha `.env` toimii sellaisenaan, myös vanhassa muodossa, jossa avaimet on nimetty rajapinnoittain.
3. Aja paketin kansiossa `npm ci`, `npm run build` ja `npm run setup:claude`.
4. Avaa Claude uudelleen.
5. Julkaise raporttisivu uudelleen kohdan 3 mukaisesti, koska uusi sivu käyttää yhtä työkalua enemmän (organisaatiolista). Vanha sivu toimii edelleen, mutta ilman uusia ominaisuuksia.

## Työkalut

| Työkalu | Kuvaus |
|---|---|
| `list_configured_organizations` | Luettelee .env-tiedostossa tunnukset saaneet organisaatiot. |
| `get_organisation_info` | Palauttaa organisaation perustiedot (nimi, Y-tunnus). |
| `get_accounting_periods` | Palauttaa organisaation tilikaudet. |
| `build_profit_and_loss_statement` | Rakentaa tuloslaskelman annetulle kaudelle. |
| `build_balance_sheet` | Rakentaa taseen annetulle päivämäärälle. |
| `get_used_chart_of_accounts` | Palauttaa kaudella käytetyt kirjanpitotilit. |
| `get_general_ledger_events` | Palauttaa sivutetun listan kirjanpidon vientiriveistä. |
| `get_dimension_settings` | Palauttaa seurantakohteiden asetukset. |
| `get_dimension_values` | Palauttaa seurantakohteen arvot. |
| `lookup_chart_of_accounts_template` | Hakee tilikarttamallin Easorin kirjastosta. |
| `sales_get_invoice` | Hakee myyntilaskuja ja yhteenvetotietoja. |
| `get_voucher_image` | Palauttaa tositteen PDF-kuvan base64-koodattuna MCP-resurssina. `voucherId` voi tulla mistä tahansa Easorin vastauksesta, jossa tositteen tunniste esiintyy (esim. kirjanpidon vientiriveiltä). Muistiotositteilla ei ole kuvaa. |

## Rajoitukset

- Raportti toimii vain työpöytäsovelluksessa koneella, jossa palvelin on asennettu.
- Kesken tilikauden taseen omaan pääomaan lasketaan kuluvan tilikauden tulos riville *Tilikauden voitto (tappio)* tuloslaskelmatilien saldoista, joten tase täsmää ennen tilinpäätöstäkin. Jos tase silti ei täsmää, sivu näyttää eron ja varoittaa siitä.
- **Taseesta voivat puuttua tilit**, joille on viimeksi kirjattu ennen vuotta 2022. Tästä sivu ei voi varoittaa.
- Seurantakohderajaus koskee vain tuloslaskelmaa, ei tasetta eikä myyntilaskuja. Se hakee enintään 20 000 vientiä kaudelta ja varoittaa, jos raja ylittyy.
- "Laskut yhteensä" sisältää myös luonnokset, eikä laskutettu summa ole sama kuin kirjanpidon liikevaihto.
- Tarkista luvut Easorin omasta raportista, ennen kuin käytät niitä päätöksenteossa.

## Vianetsintä

| Mitä näkyy | Mitä tehdä |
|---|---|
| "Easor ei ole tavoitettavissa" | Avaa sivu työpöytäsovelluksessa. Tarkista, että palvelimen nimi on `easor` ja `dist/index.js` on olemassa. |
| "Organisaatiolle ... ei ole Easor-tunnuksia" | Lisää yrityksen tunnukset tiedostoon `.env` ja käynnistä sovellus uudelleen. |
| "Missing required environment variable" | Yrityksen tunnuksista puuttuu jokin arvo. Vertaa niitä tiedostoon `.env.example`. |
| Haku palauttaa 401 tai 403 | Yrityksen tunnukset ovat väärät tai eivät kata organisaatiota. Tarkista organisaationumero ja ota tarvittaessa yhteys integraatiotukeen. |
| `npm ci` tai `npm run build` epäonnistuu | Tarkista Noden versio komennolla `node --version` (vähintään 20). Poista `node_modules` ja `dist`, jos ne on kopioitu toiselta koneelta, ja aja komennot uudelleen. |
| Palvelin ei näy sovelluksen asetuksissa (Windows) | Tarkista, että asetustiedosto on oikeassa kansiossa ja kelvollista JSONia: kenoviivat tuplana. Lopeta sovellus ilmaisinalueelta ja avaa se uudelleen. |

Palvelimen loki on tiedostossa:

- macOS: `~/Library/Logs/Claude/mcp-server-easor.log`
- Windows: `%LOCALAPPDATA%\Claude\logs\mcp-server-easor.log` (vanhoissa versioissa `%APPDATA%\Claude\logs\`)

Lokissa näkyvät vain kutsujen osoitteet, tilat ja kestot, ei lukuja.
