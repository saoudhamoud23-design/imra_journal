// ✏️  CUSTOMIZE THIS FILE before you put the app online.
//
// Everything here is only used the FIRST time she opens the app: it becomes the
// welcome screen and the first few entries in her journal. After that the journal
// is entirely hers and lives only on her phone.
//
// To include a photo, put the image in a folder called "gift" next to this file
// and write its path, e.g.  photo: "gift/first-date.jpg"

const GIFT = {
  appName: "My Little Journal",
  herName: "Imra",
  fromName: "Saoud",

  // Each line break (\n) starts a new paragraph on the welcome screen.
  welcome:
    "I made this little corner just for you.\n" +
    "A place for your thoughts, your wins, and the things you never want to forget.\n" +
    "I put a couple of memories in already. Everything after that is yours.",

  entries: [
    {
      kind: "win",
      daysAgo: 144,
      mood: 5,
      starred: true,
      text: "We met a few days before your birthday :)",
      photo: "bd.jpg",
    },
    {
      kind: "note",      // "note", "win" or "keep"
      daysAgo: 313,
      mood: 4,           // 1 to 5, or leave out
      starred: true,
      text: "The first time we have ever talked. Funny how things turned out right?.",
      photo: null,       // e.g. "gift/first-date.jpg"
    },
    
  ],
};
