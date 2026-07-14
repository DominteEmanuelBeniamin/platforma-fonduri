<!-- labels: enhancement,security -->
# Faze, activități și cereri de documente „În pregătire" / „Public"

## Context
Toate fazele, activitățile și cererile de documente ale unui proiect sunt vizibile clientului imediat ce sunt create. Consultanții nu pot pregăti structura „în culise" înainte de a o expune clientului.

## Cerință
- O **fază**, o **activitate** sau o **cerere de document** poate fi păstrată în starea **În pregătire**, vizibilă numai administratorului și consultantului.
- Clientul nu trebuie să o vadă în proiect, căutare, calendar sau notificări.
- Când este gata, elementul se **publică** și devine vizibil clientului. La publicare, clientul primește o **notificare prin email**.

## Criterii de acceptare
- [ ] Fazele, activitățile și cererile de documente au starea `În pregătire` sau `Public`; starea este vizibilă (badge) pentru admin/consultant.
- [ ] Clientul NU vede elementele „În pregătire" în: pagina proiectului, căutare, calendar, notificări, Drive, procente de progres.
- [ ] Publicarea unui element îl face vizibil clientului și declanșează notificare email către client.
- [ ] **Moștenire**: o activitate dintr-o fază „În pregătire" este ascunsă clientului indiferent de starea proprie; o cerere de document dintr-o activitate „În pregătire" la fel.
- [ ] Cererile de documente „În pregătire" sunt ascunse clientului **inclusiv la nivel de API** (detaliu cerere, descărcare modele, listări), nu doar în UI.
- [ ] Publicarea/depublicarea este înregistrată în audit.

## Note tehnice
- **Migrare SQL**: coloană `visibility` (`draft` / `published`) pe `project_phases`, `project_activities` și `activity_document_requirements`.
- **Risc principal — scurgere de date**: autorizarea este la nivel de API (service-role bypass RLS), deci fiecare endpoint citit de client trebuie să filtreze elementele nepublicate. Recomandare fermă: un helper comun „client view" (un singur loc care aplică filtrarea) folosit de toate rutele client-facing, în loc de filtre repetate în fiecare rută.
- Datele derivate trebuie și ele corectate: progresul (`progress_percent`, numărători de activități/documente) nu trebuie să includă elementele nepublicate când e afișat clientului.
- De decis comportamentul implicit la creare: elementele noi create de consultant pornesc ca „În pregătire" sau „Public"? (Recomandare: opțiune la creare, cu default „Public" pentru a nu schimba fluxul actual.)

## Dependențe
- Trebuie implementat **înaintea**: *Căutare în proiect*, *Calendar*, *Centru de notificări* (toate trebuie să respecte vizibilitatea).
- Notificarea email la publicare depinde de: *Email direct din platformă* / *Centru unic de notificări*.
- Migrarea SQL se grupează cu etapa de fundații.
