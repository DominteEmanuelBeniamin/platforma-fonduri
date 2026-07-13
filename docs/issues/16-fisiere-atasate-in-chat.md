<!-- labels: enhancement -->
# Fișiere atașate în chat

## Context
Chatul de proiect și chatul privat suportă în prezent doar mesaje text.

## Cerință
- În chat trebuie să poată fi trimise **imagini, PDF-uri, documente Word, Excel** și alte formate aprobate.
- **Imaginile au preview** direct în conversație.
- Celelalte fișiere afișează **numele, dimensiunea** și acțiunea de **deschidere sau descărcare**.

## Criterii de acceptare
- [ ] Utilizatorul poate atașa un fișier la un mesaj (buton de atașare + drag & drop opțional).
- [ ] Formatele acceptate sunt validate (tip + dimensiune maximă) atât în UI cât și în API.
- [ ] Imaginile se afișează cu preview în conversație.
- [ ] Celelalte fișiere afișează numele, dimensiunea și buton de deschidere/descărcare.
- [ ] Descărcarea se face prin URL semnat, cu verificarea accesului la conversație.
- [ ] Trimiterea de fișiere este înregistrată în audit.

## De clarificat cu echipa
- Se aplică și chatului **privat**, sau doar chatului de **proiect**? (Recomandare: ambele, cu aceeași implementare.)
- Lista exactă de formate aprobate și dimensiunea maximă per fișier.

## Note tehnice
- Se refolosește fluxul de upload existent de la documente (init → upload direct în Storage → complete), cu un bucket/prefix dedicat chatului.
- Necesită migrare SQL: metadate de atașament pe mesajele de chat (path, nume original, dimensiune, mime type) — fie coloane pe tabelul de mesaje, fie tabel separat de atașamente (recomandat dacă se dorește mai mult de un fișier per mesaj).
- Preview imagini: URL semnat cu expirare; atenție la reîmprospătarea URL-urilor la re-render.

## Dependențe
- Independent; migrarea SQL se grupează cu celelalte.
