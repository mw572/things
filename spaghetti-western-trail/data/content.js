/* Guide text, FAQs, shop items and sample forum threads for the demo. */
window.SWT = window.SWT || {};
SWT.areas = {
  north: { name: "The North", sub: "Burgos, Soria and Guadalajara", short: "Pine hills, limestone canyons, a Caliphate fortress and the empty uplands of Guadalajara.", stages: [1, 2], art: "north",
    intro: "The trail starts in the pine and juniper hills south of Burgos, at the cemetery built for the last scene of The Good, the Bad and the Ugly. From there it drops through limestone canyons to the Duero and climbs onto the bare uplands of northern Guadalajara, where villages are small and far apart.",
    ride: "Mostly firm gravel farm tracks and quiet tarmac. Expect frost and fog on spring and autumn mornings above 1,000 m, and snow on the high ground between December and March.",
    faq: [
      ["Where do I start?", "Sad Hill is 60 km south-east of Burgos. Most riders arrive in Burgos by train or ferry from Santander or Bilbao and ride down in an afternoon, passing San Pedro de Arlanza on the way."],
      ["Is there anywhere to leave a van?", "Santo Domingo de Silos has a free car park by the monastery. Ask at the bar on the square if you're leaving it for more than a few days."],
      ["How far apart is fuel?", "El Burgo de Osma and Sigüenza both have 24-hour pumps. Between them it is about 110 km, so fill up in both."]
    ] },
  middle: { name: "The Middle", sub: "Guadalajara, Cuenca and Albacete", short: "The Tagus reservoirs, carved faces in the rock, the plain of La Mancha and the first sierras.", stages: [3, 4, 5], art: "middle",
    intro: "The middle third follows the Tagus reservoirs south, past a nuclear power station being taken apart and a wood full of carved stone faces, then crosses the open plain of La Mancha by castles and windmills to the first sierras of the south.",
    ride: "The longest stages and the emptiest country. Tracks across La Mancha are fast and straight, then the trail climbs into pine forest above Riópar. Summer afternoons on the plain are very hot and there is little shade.",
    faq: [
      ["Can I swim in the reservoirs?", "Yes, at the marked beaches round Sacedón and Buendía. Don't swim near the dams."],
      ["Where is the biggest fuel gap?", "Alcaraz to Siles, about 70 km of mountain road and track. Fill up in Alcaraz."],
      ["Is it worth a day off here?", "Belmonte castle and the Río Mundo waterfall both deserve half a day, and Riópar is a good place to rest before the south."]
    ] },
  south: { name: "The South", sub: "Jaén, Granada and Almería", short: "Forests, red badlands, cave houses and the Tabernas desert, where the films were made.", stages: [6, 7, 8], art: "south",
    intro: "The south is where the films were made. The trail runs through the forests of Cazorla and Segura, across the red badlands of Gorafe and Guadix, past La Calahorra and its castle, and down into the Tabernas desert, where the western towns are still standing.",
    ride: "Rocky tracks in the sierras, then dusty and rutted ground in the badlands. Dry riverbeds (ramblas) flood fast in autumn storms, so never camp in one. Summer heat in the desert regularly passes 40°C.",
    faq: [
      ["Can I ride in the natural parks?", "Many tracks inside Andalusian natural parks are closed to motor vehicles, and the trail stays on the ones that are open. Follow the signs on the ground, which take priority over any map."],
      ["Where does the trail end?", "Tabernas. The optional coda carries on by road to Los Albaricoques, the Cortijo del Fraile and the sea at San José."],
      ["What is the best month?", "April, May and October. The south can be pleasant in March and November too, when the north is cold."]
    ] }
};
SWT.stages = {
  1: { from: "Sad Hill", to: "El Burgo de Osma", area: "north", note: "Cemetery, monastery, slot gorge and a canyon full of vultures. A short first day so you can spend time at Sad Hill." },
  2: { from: "El Burgo de Osma", to: "Sigüenza", area: "north", note: "Gormaz castle, then the empty uplands to Atienza and the cathedral town of Sigüenza." },
  3: { from: "Sigüenza", to: "Buendía", area: "middle", note: "Río Dulce gorge, the Tagus reservoirs, the Zorita nuclear plant and the carved faces." },
  4: { from: "Buendía", to: "Belmonte", area: "middle", note: "Out of the hills and onto the plain of La Mancha, ending under Belmonte castle." },
  5: { from: "Belmonte", to: "Riópar", area: "middle", note: "The longest stage. Fast tracks across the plain, then up into the pines to the Río Mundo waterfall." },
  6: { from: "Riópar", to: "Cazorla", area: "south", note: "Sierra de Segura, the castle village of Segura, the Tranco reservoir and down to Cazorla." },
  7: { from: "Cazorla", to: "Guadix", area: "south", note: "Badlands day. The dolmens of Gorafe, the canyon rim, and cave houses in Guadix." },
  8: { from: "Guadix", to: "Tabernas", area: "south", note: "La Calahorra, the Alquife pit, side trips to Calar Alto and Las Menas, then the desert and the film towns." },
  0: { from: "Tabernas", to: "the sea", area: "south", note: "Optional coda by road: Agua Caliente, the Cortijo del Fraile and a swim at San José." }
};
SWT.faq = [
  ["Who is the trail for?", "Anyone travelling under their own steam or on a trail bike. The off-road line suits a light trail bike, a gravel or mountain bike, or walkers with time. The tarmac line follows Spain's back roads for road bikes, motorcycles and cars."],
  ["Which way should I ride it?", "North to south, finishing in the desert where the films were made. The guide, distances and stage notes all run in that direction."],
  ["How long does it take?", "Eight stages for a trail bike, so eight to ten days with a rest day. On a bicycle allow two to three weeks. Walkers should plan on six to eight weeks."],
  ["Is it legal to ride the tracks?", "Rules on motor vehicles on unpaved tracks differ between Spain's regions and some tracks are signed closed. The trail line keeps to tracks that are open to traffic as far as we know, but signs on the ground always win. If a track is closed, take the tarmac line round it and tell us in the Saloon so the map gets fixed."],
  ["Can I wild camp?", "Wild camping is restricted in most of Spain, and banned in natural parks. Ask permission at farms, use campsites, or stay in the casas rurales and hostales listed in the guide."],
  ["Is there phone signal?", "Patchy in the sierras and absent in some valleys. That is why this guide works with no signal once you've saved it to your phone."],
  ["Do I need a GPS?", "No. Save the trail on your phone and the map, places and guide all work in flight mode. The route files are in the Trading Post if you prefer a dedicated GPS."],
  ["How do I suggest a place?", "Use 'Suggest a place' in the Saloon. The moderators check each suggestion and approved places appear on the map at the next update."]
];
SWT.products = [
  { id: "book", name: "The Spaghetti Western Trail", kind: "Guidebook", price: 35, art: "book",
    text: "The hardback guide: 320 pages of stage notes, stories of the films and the people who made them, and photographs of every location then and now.",
    options: [] },
  { id: "foldmap", name: "Folding trail map", kind: "Paper map", price: 14, art: "foldmap",
    text: "Waterproof paper, 1:200,000, in three sheets for North, Middle and South. The trail in green and the tarmac route in black, as on the original hand-drawn map.",
    options: [] },
  { id: "wallmap", name: "Pictorial wall map", kind: "Print", price: 45, art: "wallmap",
    text: "The illustrated map of the whole trail, printed on heavy matt paper. A souvenir for when you're home, or a plan for the trip.",
    options: [["A2 unframed", 45], ["A1 unframed", 65], ["A1 framed, black oak", 140]] },
  { id: "gpx", name: "Route files", kind: "Download", price: 8, art: "gpx",
    text: "GPX files for the trail and the tarmac route, split by stage, with every place in this guide as a waypoint.",
    options: [] }
];
SWT.boards = [
  { id: "conditions", name: "Trail conditions", text: "Closed tracks, washouts, floods and diversions." },
  { id: "north", name: "The North", text: "Sad Hill to Sigüenza." },
  { id: "middle", name: "The Middle", text: "Sigüenza to Riópar." },
  { id: "south", name: "The South", text: "Riópar to Tabernas." },
  { id: "kit", name: "Bikes and kit", text: "What to ride, what to take." },
  { id: "meet", name: "Meet-ups", text: "Find people to ride with." },
  { id: "places", name: "Places", text: "One thread for every place on the map." }
];
SWT.threads = [
  { id: "t1", board: "conditions", title: "Track closed after the Río Mundo waterfall (stage 5)", author: "Dusty_Pete", when: "2 days ago", stage: 5,
    posts: [["Dusty_Pete", "New chain and a sign across the track about 3 km after the waterfall car park. Looks like the forestry people. Took the tarmac line round, about 9 km extra."],
            ["mariaenduro", "Same on Sunday. The ranger at the visitor centre said it's for logging and should reopen in December."],
            ["Trail moderator", "Thanks both. Marked as closed on the map until we hear otherwise."]] },
  { id: "t2", board: "north", title: "Sad Hill on a Sunday, is the road open?", author: "TwoStrokeTom", when: "5 days ago", stage: 1,
    posts: [["TwoStrokeTom", "Arriving Burgos Saturday night, want to do Sad Hill first thing Sunday. Is the gravel road in open on Sundays?"],
            ["Blondie_rides", "Open every day. Get there before 10 and you'll have it to yourself. Coffee in Contreras afterwards."]] },
  { id: "t3", board: "south", title: "Best café in Guadix that opens before 8?", author: "Angel_Eyes_KTM", when: "1 week ago", stage: 7,
    posts: [["Angel_Eyes_KTM", "Leaving early to beat the heat to Tabernas. Anywhere doing coffee before 8?"],
            ["mariaenduro", "The bar in the station opens at 6 for the railway workers."]] },
  { id: "t4", board: "kit", title: "Fuel range: is 250 km enough?", author: "Tuco74", when: "2 weeks ago", stage: 5,
    posts: [["Tuco74", "My bike does about 250 km on a tank. Any gaps longer than that?"],
            ["Dusty_Pete", "Longest I found was Alcaraz to Siles, about 70 km. You'll be fine. Just don't skip a fill-up in Alcaraz."]] },
  { id: "t5", board: "meet", title: "Riding south in May, anyone want to join?", author: "Blondie_rides", when: "3 weeks ago", stage: null,
    posts: [["Blondie_rides", "Two of us on DR650s, leaving Burgos 9 May, eight days down. Happy to have a couple more."]] }
];
SWT.suggestionsSeed = [
  { id: "sg1", name: "Abandoned venta on the old N-301", cat: "odd", lat: 39.3, lon: -2.52, by: "Tuco74", text: "Roadside inn with its painted sign still up, roof gone. Good photo stop on the plain.", stage: 5 },
  { id: "sg2", name: "Spring at Fuente del Pino", cat: "wc", lat: 38.36, lon: -2.61, by: "mariaenduro", text: "Drinking water right by the track, flows all year.", stage: 6 }
];
