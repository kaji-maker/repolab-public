# V5 submission build map

This is the V5 **source** candidate. The source preview and portable recorded review are read-only. The hosted demo is a separately operated V2 service; the packages must not be described as one identical deployment.

| Artifact | Exact identity | What it does |
| --- | --- | --- |
| Source candidate | 716-file `SOURCE_MANIFEST.json`; digest is supplied separately in `REVIEWER_START.md` | Rebuilds the V5 read-only preview and includes current hosted V2 server/runtime source. It excludes credentials, private run state, host dependency authority/lock, and dispatch admission. |
| Portable recorded review | V3 review manifest; digest is supplied separately | Displays the historical October 25 run and compact equivalent patch. It is read-only and is not the hosted V2 run. |
| Hosted demo | `https://repolab.34-71-102-74.sslip.io` | Authenticated, manually started hosted V2 service. The latest documented result is `b2a8768c-acae-4ed4-8565-8725a5fa0120`; its complete private runtime authority is not part of this ZIP. Supply judge access separately; never include credentials in source or release assets. |

Hosted V2 runtime source freeze: `75a853e5be44334449705554f734478d045972670419ab487d8289c0722cac10`. Dependency/control freeze: `123aedef027e87efb2e96a6cbc0c72bc074e5be4eb21cc2aceed4205f60c7703`. The host includes protected freeze data, dependency artifacts, provider configuration, and persistent state that are intentionally absent from the public source candidate. Without them the included server refuses startup; do not weaken that guard to make a source checkout dispatch repairs.

The V5 read-only preview is not a web deployment of the hosted app. The portable review's October 25 evidence is not a reproduction of the October 27 hosted run. Keep those scopes separate in the project description and video. The candidate remains unpublished pending owner approval; previous AI review covered the earlier 701-file V5 and does not qualify this expanded 716-file source.
