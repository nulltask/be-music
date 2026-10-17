---
'@be-music/player': patch
---

AUTO play ended the moment its chart was over even when the host passed `holdAfterChart`, so an AUTO play's keys went dead and its outro started before a manual play's would: `autoPlay` now honours `holdAfterChart` like `manualPlay`, calling `onSettled` once the chart is over and staying open until the signal aborts.
