// Test harness for deployProactiveExtShifts (Step 0)
// Runs against the real roster to see what it produces

const fs = require('fs');
const roster = JSON.parse(fs.readFileSync('./roster-backup-current.json', 'utf8'));
const sourceEmps = roster.data.shift_employees;
const cfg = roster.data.shift_settings;

// ── Constants from the scheduler ──
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const SHIFTS = [
  { id: "first",  label: "1st Shift", time: "0600 – 1400" },
  { id: "second", label: "2nd Shift", time: "1400 – 2200" },
  { id: "third",  label: "3rd Shift", time: "2200 – 0600" },
];
const EXT_PAIRS = [
  {
    id: "day",   label: "Day 12hr",   time: "0600 – 1800",
    covers: ["first","second"],
    coversB: ["second","third"],
    color: "#7c3aed",
    startHour: 6,
  },
  {
    id: "night", label: "Night 12hr", time: "1800 – 0600",
    covers: ["second","third"],
    coversB: ["first","second"],
    color: "#0e7490",
    startHour: 18,
  },
  {
    id: "swing-10a-10p", label: "10A–10P", time: "1000 – 2200",
    covers: ["second"],
    color: "#b45309",
    isSwing: true,
    startHour: 10,
  },
  {
    id: "swing-10p-10a", label: "10P–10A", time: "2200 – 1000",
    covers: ["third"],
    color: "#1d4ed8",
    isSwing: true,
    startHour: 22,
  },
  {
    id: "swing-2p-2a", label: "2P–2A", time: "1400 – 0200",
    covers: ["second","third"],
    color: "#be185d",
    isSwing: true,
    startHour: 14,
  },
  {
    id: "swing-2a-2p", label: "2A–2P", time: "0200 – 1400",
    covers: ["third","first"],
    color: "#065f46",
    isSwing: true,
    startHour: 2,
  },
  {
    id: "split", label: "Split 2pm–2am/2am–2pm", time: "1400 – 1400 (+1d)",
    covers: ["second","third"],
    coversB: ["third"],
    crossDayB: "first",
    color: "#b45309",
    startHour: 14,
    startHourB: 2,
    nextDayB: true,
  },
];

// ── canWorkExtHalf from the scheduler ──
const canWorkExtHalf = (emp, pairId, slotIndex) => {
  const pair = EXT_PAIRS.find(p => p.id === pairId);
  if (!pair) return true;
  const shiftId = pair.covers[slotIndex];
  if (shiftId && (emp.blockedShifts || []).includes(shiftId)) return false;
  // requiredShift: check against all shifts the employee's half physically covers
  const physicalCoverage = (slotIndex === 1 && pair.coversB) ? pair.coversB : pair.covers;
  if (emp.requiredShift && !physicalCoverage.includes(emp.requiredShift)) return false;
  if (pair.isSwing) {
    const eligible = emp.swingEligible || [];
    return eligible.includes(pairId);
  }
  if (pairId === "split") {
    if (!emp.splitShiftEligible) return false;
    if (slotIndex === 1 && (emp.blockedShifts || []).includes("first")) return false;
    return true;
  }
  const pref = emp.ext12hPref || null;
  if (pref === null) return false;
  if (pref === "both") return true;
  if (pref === "day"   && pairId !== "day")   return false;
  if (pref === "night" && pairId !== "night") return false;
  return true;
};

// ── The function under test ──
function deployProactiveExtShifts(sourceEmps, cfg, empTimeOffDays, existingExtShifts) {
  const autoExts = [];
  const usedKeys = new Set();
  const maxShifts = cfg?.maxConsecutiveShifts ?? 5;
  const MAX_EXT_PER_EMP = 2;
  const MAX_EXT_PER_DEFICIT = 3;

  (existingExtShifts || []).forEach(ext => usedKeys.add(ext.day + "__" + ext.pairId));

  const empExtCount = {};
  (existingExtShifts || []).forEach(ext => {
    if (ext.empAId) empExtCount[ext.empAId] = (empExtCount[ext.empAId] || 0) + 1;
    if (ext.empBId) empExtCount[ext.empBId] = (empExtCount[ext.empBId] || 0) + 1;
  });

  const shiftDedicated = {};
  SHIFTS.forEach(shift => {
    shiftDedicated[shift.id] = sourceEmps.filter(e => {
      if (e.employmentType !== "full-time") return false;
      if (e.inTraining) return false;
      const isSup = (e.qualifications || []).includes("Supervisor");
      if (isSup) return shift.id === "first";
      if (e.requiredShift) return e.requiredShift === shift.id;
      const prefs = e.preferredShifts || [];
      if (prefs.length === 1) return prefs[0] === shift.id;
      return false;
    });
  });

  console.log("\n=== SHIFT DEDICATION ANALYSIS ===");
  SHIFTS.forEach(shift => {
    const ded = shiftDedicated[shift.id];
    console.log(`\n${shift.label} (${shift.id}): ${ded.length} dedicated FT employees`);
    ded.forEach(e => {
      const quals = (e.qualifications || []).join(", ");
      console.log(`  - ${e.name} [${quals}] ext12h=${e.ext12hPref || "none"}`);
    });
    for (const role of ["Medical", "Scale"]) {
      const providers = ded.filter(e => (e.qualifications || []).includes(role));
      console.log(`  ${role} providers: ${providers.length} → ${providers.map(e => e.name).join(", ") || "NONE"}`);
    }
  });

  console.log("\n=== DEFICIT ANALYSIS & EXT SHIFT DEPLOYMENT ===\n");

  SHIFTS.forEach(targetShift => {
    const dedicated = shiftDedicated[targetShift.id];

    for (const role of ["Medical", "Scale"]) {
      const providers = dedicated.filter(e =>
        (e.qualifications || []).includes(role)
      );

      if (providers.length > 1) continue;

      const coveredDays = providers.length * maxShifts;
      const gapDays = Math.max(0, 7 - coveredDays);
      if (gapDays === 0) continue;

      const soleProviderIds = new Set(providers.map(e => e.id));

      console.log(`DEFICIT: ${targetShift.label} / ${role}`);
      console.log(`  Providers: ${providers.length} (${providers.map(e=>e.name).join(", ") || "none"})`);
      console.log(`  Gap days: ${gapDays} (maxShifts=${maxShifts})`);

      const dayScores = DAYS.map(day => {
        const allAvail = sourceEmps.filter(e => {
          if (e.inTraining) return false;
          if (!(e.qualifications || []).includes(role)) return false;
          if ((e.unavailableDays || []).includes(day)) return false;
          if ((e.blockedShifts || []).includes(targetShift.id)) return false;
          if (e.requiredShift && e.requiredShift !== targetShift.id && !e.crossShiftOT) return false;
          return true;
        });
        return { day, coverage: allAvail.length, names: allAvail.map(e=>e.name) };
      }).sort((a, b) => a.coverage - b.coverage);

      console.log("  Day urgency (sorted):");
      dayScores.forEach(d => console.log(`    ${d.day}: ${d.coverage} available [${d.names.join(", ")}]`));

      let deployed = 0;
      for (const { day } of dayScores) {
        if (deployed >= Math.min(gapDays, MAX_EXT_PER_DEFICIT)) break;

        let found = false;
        for (const pair of EXT_PAIRS) {
          if (found) break;
          if (pair.isSwing) continue;
          if (pair.id === "split") continue;

          const coverIdx = pair.covers.indexOf(targetShift.id);
          if (coverIdx === -1) continue;

          const extKey = day + "__" + pair.id;
          if (usedKeys.has(extKey)) continue;

          const providerSlot = coverIdx;
          const otherSlot = 1 - providerSlot;

          console.log(`  Trying ${pair.label} on ${day} (provider=slot${providerSlot}):`);

          const providerCands = sourceEmps.filter(e => {
            if (e.inTraining) return false;
            if (soleProviderIds.has(e.id)) {
              // console.log(`    SKIP ${e.name}: sole provider`);
              return false;
            }
            if ((e.unavailableDays || []).includes(day)) return false;
            if (!canWorkExtHalf(e, pair.id, providerSlot)) {
              // Show WHY they fail
              const p = EXT_PAIRS.find(pp => pp.id === pair.id);
              const shiftCheck = p ? p.covers[providerSlot] : "?";
              if (e.qualifications.includes(role)) {
                console.log(`    SKIP ${e.name}: canWorkExtHalf failed (covers[${providerSlot}]=${shiftCheck}, required=${e.requiredShift||"none"}, ext12h=${e.ext12hPref||"none"})`);
              }
              return false;
            }
            if (!(e.qualifications || []).includes(role)) return false;
            if ((empExtCount[e.id] || 0) >= MAX_EXT_PER_EMP) return false;
            return true;
          }).sort((a, b) => {
            const aDed = shiftDedicated[targetShift.id].some(d => d.id === a.id) ? 1 : 0;
            const bDed = shiftDedicated[targetShift.id].some(d => d.id === b.id) ? 1 : 0;
            if (aDed !== bDed) return aDed - bDed;
            return (b.qualifications || []).length - (a.qualifications || []).length;
          });

          if (!providerCands.length) {
            console.log(`    No provider candidates for ${role}`);
            continue;
          }

          const chosenProvider = providerCands[0];
          console.log(`    Provider: ${chosenProvider.name} [${chosenProvider.qualifications.join(",")}]`);

          const otherCands = sourceEmps.filter(e => {
            if (e.inTraining) return false;
            if (e.id === chosenProvider.id) return false;
            if ((e.unavailableDays || []).includes(day)) return false;
            if (!canWorkExtHalf(e, pair.id, otherSlot)) return false;
            if ((empExtCount[e.id] || 0) >= MAX_EXT_PER_EMP) return false;
            return true;
          }).sort((a, b) => {
            const aSpec = ["Scale", "Medical"].filter(r => (a.qualifications || []).includes(r)).length;
            const bSpec = ["Scale", "Medical"].filter(r => (b.qualifications || []).includes(r)).length;
            return bSpec - aSpec;
          });

          const empOther = otherCands.length ? otherCands[0] : null;

          const empAId = providerSlot === 0 ? chosenProvider.id : (empOther ? empOther.id : null);
          const empBId = providerSlot === 1 ? chosenProvider.id : (empOther ? empOther.id : null);

          if (providerSlot === 0 && !empAId) continue;
          if (providerSlot === 1 && !empBId) continue;

          const empA = empAId ? sourceEmps.find(e => e.id === empAId) : null;
          const empB = empBId ? sourceEmps.find(e => e.id === empBId) : null;
          const combinedRoles = [...new Set([
            ...(empA ? ["Scale", "Medical"].filter(r => empA.qualifications.includes(r)) : []),
            ...(empB ? ["Scale", "Medical"].filter(r => empB.qualifications.includes(r)) : []),
          ])];

          autoExts.push({
            pairId: pair.id, day,
            empAId: empAId || null,
            empBId: empBId || null,
            roles: combinedRoles,
            approvedAt: "auto-fill", auto: true, proactive: true,
          });

          usedKeys.add(extKey);
          if (empAId) empExtCount[empAId] = (empExtCount[empAId] || 0) + 1;
          if (empBId) empExtCount[empBId] = (empExtCount[empBId] || 0) + 1;
          deployed++;
          found = true;

          console.log(`    ✓ DEPLOYED: ${pair.label} on ${day} → empA=${empA?.name || "—"}, empB=${empB?.name || "—"} roles=[${combinedRoles}]`);
        }
      }

      if (deployed > 0) {
        console.log(`  → Deployed ${deployed} ext shift(s)\n`);
      } else if (gapDays > 0) {
        console.log(`  → WARNING: No ext shift candidates qualify for this deficit\n`);
      }
    }
  });

  console.log("\n=== RESULTS ===");
  console.log(`Total proactive ext shifts: ${autoExts.length}`);
  autoExts.forEach((ext, i) => {
    const empA = ext.empAId ? sourceEmps.find(e => e.id === ext.empAId) : null;
    const empB = ext.empBId ? sourceEmps.find(e => e.id === ext.empBId) : null;
    console.log(`  ${i+1}. ${ext.day} / ${ext.pairId} → empA=${empA?.name || "—"}, empB=${empB?.name || "—"} roles=[${ext.roles}]`);
  });

  // Show per-employee ext commitment
  console.log("\nEmployee ext shift commitments:");
  Object.entries(empExtCount).filter(([,v]) => v > 0).forEach(([id, count]) => {
    const emp = sourceEmps.find(e => e.id === id);
    console.log(`  ${emp?.name || id}: ${count} ext shift(s)`);
  });

  return autoExts;
}

// Run the test
const result = deployProactiveExtShifts(sourceEmps, cfg, null, []);
