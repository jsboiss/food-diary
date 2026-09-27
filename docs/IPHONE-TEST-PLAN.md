# iPhone field test

Record device model, iOS version, Safari version, test URL/build and date. Use non-sensitive test photos. Run in Safari and again after Add to Home Screen. A desktop pass does not count as an iPhone pass.

| Test | Expected result | Result/notes |
| --- | --- | --- |
| Sign in / wrong password / sign out | Wrong password rejected; diary and photo URLs require session; sign out hides timeline | Pending |
| Camera capture | Rear camera opens; selected photo displays; save needs no description | Pending |
| Photo library JPEG, PNG, WebP, HEIC | First three process; document whether Safari converts HEIC; an unsupported format gives a visible error without losing entry | Pending |
| Portrait/landscape rotation | Preview is upright and not stretched | Pending |
| 12/24/48MP source | Accepted under 20 MB and 60 MP; preview <=2,000,000 pixels | Pending |
| Small image | Preview never enlarged | Pending |
| Preview inspect | WebP, quality configured as 80; readable when opened full-screen | Pending |
| Save during processing | Immediate local save; can log next entry while earlier job runs | Pending |
| Close after upload | Server processing finishes without app open | Pending |
| Airplane mode before Save | Entry stays local; reopen/reconnect and it uploads once | Pending |
| Close during upload | Pending draft survives relaunch; upload retry produces one entry | Pending |
| Force server restart during analysis | Job recovers and original is deleted after saved result | Pending |
| Simulate failure checkbox | Preview appears; failed status and Retry appear; original retained | Pending |
| Retry failed simulation | Completes; original deleted; preview still loads | Pending |
| Original retention audit | Failure originals removed after 24h; preview remains; inspect private volume | Pending |
| Stomach-only check-in | No photo required; rating and timestamp exported | Pending |
| Skip rating | CSV leaves rating empty, not good | Pending |
| Barcode photo: local common products | Decoder finds retail code; product lookup or explicit missing result | Pending |
| Blurry/unknown barcode | Clear failure; rest of diary still works | Pending |
| CSV on iPhone | Downloads/opens; share via Files/Mail; times/ratings readable | Pending |
| Home Screen / offline reopen | App shell opens; pending drafts visible; no claim of server sync while offline | Pending |
| Camera denied / storage unavailable | No false success; usable error/recovery | Pending |

Known limitations: no real AI, no HEIC decoder, no meal editing/deletion/draft discard UI, single shared login, single-process persistence. Backdating a photo currently also backdates its attached stomach rating; keep prototype entries at the current time when testing that rating. Separate timestamps are required before real daily use. Offline local storage is a convenience, not a durable backup. Photo files remaining in the iPhone Photos app are user-owned and are never deleted by this app.

Stop/go decision: do not start partner rollout until capture, upload recovery, privacy, reliable exports and real model evaluation pass. Log issues without attaching personal food/symptom data to the public repository.
