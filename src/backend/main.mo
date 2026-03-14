import Array "mo:core/Array";
import List "mo:core/List";
import Map "mo:core/Map";
import Runtime "mo:core/Runtime";
import Order "mo:core/Order";
import Principal "mo:core/Principal";

actor {
  type ScoreEntry = {
    name : Text;
    score : Nat;
  };

  module ScoreEntry {
    public func compare(entry1 : ScoreEntry, entry2 : ScoreEntry) : Order.Order {
      Nat.compare(entry2.score, entry1.score);
    };
  };

  let topScores = Map.empty<Principal, ScoreEntry>();

  public shared ({ caller }) func saveScore(name : Text, score : Nat) : async () {
    if (topScores.containsKey(caller)) {
      Runtime.trap("User already submitted a score. ");
    };

    let scoreEntry : ScoreEntry = {
      name;
      score;
    };
    topScores.add(caller, scoreEntry);
  };

  public query ({ caller }) func getTopScores() : async [ScoreEntry] {
    let size = if (topScores.size() < 10) { topScores.size() } else { 10 };

    let allEntries = topScores.values().toArray().sort();

    let scores = List.empty<ScoreEntry>();
    for (i in allEntries.keys()) {
      if (scores.size() < size) {
        scores.add(allEntries[i]);
      };
    };

    scores.toArray();
  };
};
