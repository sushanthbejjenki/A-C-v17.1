const fs=require('fs');
const path=require('path');
const {buildWorkbook}=require('../src/utils/xlsxExport');
const rows=[
 ['Name','Employee ID','Employee Type','Email','Username','Password','Phone','Department','Designation','Attendance Schedule Enabled','Check-In Time','Grace Minutes','Check-Out Time','Allow Multiple Check-Ins','Max Check-Ins Per Day','Profile Picture'],
 ['Example Employee','EMP001','employee','employee@example.com','employee1','ChangeMe123!','','IT','Developer','TRUE','09:00','10','18:00','FALSE','1','Insert an image in this row (optional)'],
 ['', '', 'intern', '', '', '', '', '', '', 'TRUE','10:00','10','17:00','FALSE','1',''],
 ['', '', 'wfh', '', '', '', '', '', '', 'FALSE','','0','','TRUE','3','']
];
const out=path.join(__dirname,'..','public','employee-bulk-import-template.xlsx');
fs.writeFileSync(out,buildWorkbook([{name:'Employees',rows}]));
console.log(out);
