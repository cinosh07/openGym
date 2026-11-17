# Build personnel d'openGym (téléphone Android + montre Garmin)

Scripts PowerShell pour construire soi-même l'app Android (signée avec sa propre clé) et l'app de la
montre fenix 8. Tout est expliqué dans `opengym-mon-build.md` (dépôt Trail-Coarch).

    .\perso\build-montre.ps1 [-Installer]     montre : frontend\garmin\bin\opengym-fenix847mm.prg
    .\perso\build-android.ps1 [-Installer]    téléphone : perso\sortie\openGym-<version>-perso.apk

Clés attendues (jamais dans le dépôt) : `D:\Sauvegardes\cles\opengym_developer_key.der` (Garmin),
`D:\Sauvegardes\cles\opengym-android.keystore` et `opengym-android.password.txt` (Android).
