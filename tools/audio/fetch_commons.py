import json, sys, urllib.request, urllib.error, os, time
info = {o["title"]: o for o in json.load(open(sys.argv[1]))}
dst_dir = sys.argv[2]
want = {
 "thrush_call_c": "File:Turdus philomelos - Song Thrush XC434600.mp3",
 "fieldfare_call_a": "File:Turdus pilaris - Fieldfare XC531160.mp3",
 "fieldfare_call_b": "File:Turdus pilaris - Fieldfare XC403028.mp3",
 "chaffinch_call_a": "File:Fringilla coelebs - Common Chaffinch XC539300.mp3",
 "chaffinch_call_b": "File:Fringilla coelebs - Common Chaffinch XC560861.mp3",
 "mistle_call_a": "File:Turdus viscivorus - Mistle Thrush XC430010.mp3",
 "thrush_song_a": "File:Turdus philomelos - Song Thrush XC541754.mp3",
 "chaffinch_song_a": "File:Fringilla coelebs - Common Chaffinch XC489896.mp3",
 "thrush_song_b": "File:Turdus philomelos - Song Thrush XC527483.mp3",
 "chaffinch_song_b": "File:Fringilla coelebs - Common Chaffinch XC482887.mp3",
 "turtle_a": "File:Streptopelia turtur - European Turtle Dove XC582028.mp3",
 "turtle_b": "File:Streptopelia turtur - European Turtle Dove XC481626.mp3",
 "pigeon_a": "File:Columba palumbus - Common Wood Pigeon XC561877.mp3",
 "pigeon_b": "File:Columba palumbus - Common Wood Pigeon XC108354.mp3",
}
credits = json.load(open("commons_credits.json")) if os.path.exists("commons_credits.json") else {}
for k, t in want.items():
    o = info[t]; ext = os.path.splitext(t)[1]
    dst = os.path.join(dst_dir, k + ext)
    if os.path.exists(dst): continue
    url = o["url"].split("?")[0]
    data = None
    for attempt in range(8):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "LebanonHunt3D-dev/0.1 (personal non-commercial game; github.com/MohamadHazeem)"})
            data = urllib.request.urlopen(req, timeout=120).read()
            break
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
            time.sleep(30 * (attempt + 1))
    if data is None:
        print("GAVE UP", k, flush=True); continue
    open(dst, "wb").write(data)
    credits[k] = {"file": t[5:], "page": "https://commons.wikimedia.org/wiki/" + t.replace(" ", "_"), "license": o["lic"], "artist": o["artist"].strip()}
    json.dump(credits, open("commons_credits.json", "w"), indent=1)
    print("ok", k, len(data), flush=True)
    time.sleep(30)
