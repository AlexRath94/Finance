# Finanzplaner

Persönliche Finanzplanung als Android-App: Töpfe (Budget-Umschläge) mit ankreuzbaren Unterpunkten, mehrere Banken/Konten mit Unterkonten,
Import von Kontoauszügen mit Fragesession, Edelmetall-Bestand mit Live-Kurs und Gesamtvermögen.
Alle Daten bleiben auf dem Handy, ohne Server und ohne Google-Cloud-Sicherung. Die einzige Netzwerkverbindung ist der optionale Abruf
der Edelmetallkurse, alles andere blockiert eine Content-Security-Policy.

## Android-App (APK)

Bei jedem Push baut GitHub Actions (`.github/workflows/android.yml`) die APK, signiert sie und stellt sie unter **Releases** bereit
(`Finanzen.apk`). Neue Versionen lassen sich über die installierte App installieren, die Daten bleiben erhalten.

Benötigte Repository-Secrets (Settings → Secrets and variables → Actions):
- `ANDROID_KEYSTORE_BASE64` – Signierschlüssel (PKCS12, Alias `finanzplaner`) als Base64
- `ANDROID_KEYSTORE_PASSWORD` – Passwort dazu

Ohne diese Secrets wird nur testweise gebaut und nichts veröffentlicht, denn mit wechselndem Schlüssel wären Updates nicht installierbar.

## Starten

```bash
npm install
npm run dev      # Entwicklung: http://localhost:5173
npm run build    # Web-Version in dist/
npm run build:android  # Dateien für die APK bauen und ins Android-Projekt kopieren
npm test         # Unit-Tests (Parser, Regeln, Salden)
```

## Funktionen

- **Töpfe**: Einzahlungen werden summiert, Ausgaben abgezogen. Je Topf frei anlegbare Unterpunkte, Monatsbudget, Soll-Zuführung,
  Sparziel und Mindeststand. Farbliche Warnung: rot = Unterdeckung (Stand < 0), gelb = unter Mindeststand bzw. Budget (fast) überschritten.
  „Nicht verteilt“ zeigt das Geld auf Budget-Konten, das noch keinem Topf gehört; „Geld verteilen“ füllt die Töpfe nach Soll-Zuführung.
- **Buchungen**: Ausgabe, Einnahme, Umbuchung zwischen Konten, Umschichtung zwischen Töpfen. Topf per Chip wählen, Unterpunkte ankreuzen,
  neue Unterpunkte direkt im Formular anlegen, eine Buchung auf mehrere Töpfe aufteilen. Filter, Suche und CSV-Export.
- **Konten**: beliebige Banken, Kontoarten und Unterkonten (z. B. Sparkasse mit Unterkonten, Trade Republic Verrechnungskonto + Depot,
  Bargeld). Summen je Konto, je Bank und gesamt. Saldo-Abgleich bzw. Depotwert per Korrekturbuchung.
- **Import**: CSV (Sparkasse CSV-CAMT/CSV-MT940, beliebige Bank-CSV mit Spaltenzuordnung, die gemerkt wird), MT940, CAMT-XML und
  PDF-Kontoauszüge (heuristisch). Duplikate und Gegenbuchungen von Umbuchungen werden erkannt; das Zielkonto wird per IBAN erkannt.
- **Fragesession**: unbekannte Buchungen nacheinander einem Topf (plus Unterpunkte), einer Umbuchung oder „ignorieren“ zuordnen.
  „Merken“ legt eine Regel an, die passende offene und künftige Buchungen automatisch zuordnet. Tastatur: 1–9 Topf, Enter speichern, S überspringen.
- **Edelmetalle**: Spotpreise für Gold, Silber, Platin, Palladium in €/oz, €/g, €/kg (gold-api.com, mit EZB-Kurs in Euro umgerechnet;
  manuelle Eingabe als Fallback). Bestand mit Vorlagen für gängige Münzen/Barren, eigenem Feingewicht oder Raugewicht × Feinheit,
  Kaufpreis und Gewinn/Verlust.
- **Übersicht**: Gesamtvermögen (Konten + Edelmetalle), Aufteilung nach Bank, Verlauf, Topf-Ampel, Einnahmen/Ausgaben je Monat.

## Datenschutz

- **Speicher:** IndexedDB in der App auf dem Handy; Android-Cloud-Sicherung und Geräteübertragung sind abgeschaltet.
- **Netzwerk:** nur `api.gold-api.com` (Kurse in USD) und `api.frankfurter.dev`/`.app` (EZB-Wechselkurs), anonyme GET-Anfragen
  ohne Cookies und Referrer. Abschaltbar im Tab „Edelmetalle“ – dann stellt die App keinerlei Verbindungen her.
  Die Content-Security-Policy (`vite.config.ts`) lässt technisch keine anderen Ziele zu.
- **Teilen mit Partner/in:** „Meinen Stand senden“ erzeugt eine mit AES-256-GCM verschlüsselte Datei (Schlüssel per PBKDF2 aus dem
  gemeinsamen Passwort), die per Messenger/AirDrop verschickt und auf dem anderen Gerät mit „Stand übernehmen“ zusammengeführt wird.
  Zusammenführung pro Eintrag nach Änderungszeit, Löschungen werden mitübertragen, doppelt importierte Kontoauszüge werden erkannt.
- **Sicherung:** gleiche Datei, verschlüsselt sobald ein Passwort gesetzt ist; „Sicherung laden“ ersetzt den Stand komplett.
