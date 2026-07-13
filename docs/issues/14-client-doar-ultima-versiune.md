<!-- labels: enhancement,security -->
# Clientul vede numai ultima versiune a documentului

## Context
Fișierele încărcate pe o cerere de document sunt versionate (`activity_document_files.version_number`). În prezent clientul poate vedea și versiunile mai vechi.

## Cerință
- La o cerere de document, clientul vede **numai ultima versiune** încărcată.
- Versiunile mai vechi **nu se pierd**: rămân în Drive ca istoric, disponibile administratorului și consultanților.

## Criterii de acceptare
- [ ] În detaliul unei cereri, clientul vede doar ultima versiune (cea cu `version_number` maxim, neștearsă).
- [ ] Admin și consultant văd în continuare istoricul complet al versiunilor.
- [ ] **Enforcement în API, nu doar în UI**: endpoint-ul de descărcare (`/api/files/[fileId]/signed-download`) refuză clientului fișierele care nu sunt ultima versiune.
- [ ] Arhiva ZIP descărcată de client (`/api/files/bulk-archive`) conține doar ultimele versiuni.

## Note tehnice
- Filtrarea se aplică în toate endpoint-urile client-facing care returnează fișiere (detaliu cerere, Drive, arhivă ZIP).
- Se recomandă integrarea în același helper „client view" propus la *Faze și activități În pregătire/Public* — un singur loc care definește ce vede clientul.

## Dependențe
- De implementat împreună cu: *Faze și activități În pregătire/Public* (același mecanism de filtrare).
