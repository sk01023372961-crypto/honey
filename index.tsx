import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";

const API_KEY = process.env.API_KEY;

interface Counsel {
  id: string;
  date: string;
  audio?: Blob;
  transcription: string;
  feedback: string;
  reflectionImage?: string;
  educationalNotes?: string;
}

interface Student {
  id:string;
  class: string;
  number: string;
  name: string;
  mbti: string;
  notes: string;
  counsels: Counsel[];
}

type Tab = 'register' | 'log' | 'education';

const App = () => {
  const [activeTab, setActiveTab] = useState<Tab>('register');
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [expandedCounselId, setExpandedCounselId] = useState<string | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);


  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const handleAddStudent = (student: Omit<Student, 'id' | 'counsels'>) => {
    const newStudent: Student = {
      ...student,
      id: Date.now().toString(),
      counsels: [],
    };
    setStudents(prev => [...prev, newStudent].sort((a,b) => `${a.class}-${a.number}`.localeCompare(`${b.class}-${b.number}`)));
    alert(`${student.name} 학생 정보가 등록되었습니다.`);
  };

  const handleUpdateStudent = (studentToUpdate: Student) => {
    setStudents(prev => 
        prev.map(s => s.id === studentToUpdate.id ? studentToUpdate : s)
            .sort((a,b) => `${a.class}-${a.number}`.localeCompare(`${b.class}-${b.number}`))
    );
    alert(`${studentToUpdate.name} 학생 정보가 수정되었습니다.`);
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (event) => {
        audioChunks.current.push(event.data);
      };

      mediaRecorder.current.onstop = () => {
        const blob = new Blob(audioChunks.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.current.start();
      setIsRecording(true);
      setAudioBlob(null);
    } catch (error) {
      console.error("마이크 접근에 실패했습니다:", error);
      alert("마이크 사용 권한이 필요합니다. 브라우저 설정을 확인해주세요.");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorder.current && mediaRecorder.current.state === "recording") {
      mediaRecorder.current.stop();
      setIsRecording(false);
    }
  }, []);

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result.split(',')[1]);
        } else {
          reject(new Error("Failed to convert blob to base64"));
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleTranscribeAndFeedback = async () => {
    if (!audioBlob || !selectedStudentId) return;

    setIsLoading(true);
    try {
      const student = students.find(s => s.id === selectedStudentId);
      if (!student) throw new Error("Student not found");

      const base64Audio = await blobToBase64(audioBlob);

      const audioPart = {
        inlineData: {
          mimeType: audioBlob.type,
          data: base64Audio,
        },
      };

      const prompt = `
        초등학생 상담 내용입니다.
        학생 정보:
        - 이름: ${student.name}
        - MBTI: ${student.mbti || '정보 없음'}
        - 성격 특성: ${student.notes}

        먼저, 제공된 오디오를 듣고 상담 내용을 빠짐없이 정확하게 텍스트로 변환해주세요.
        그 다음, 변환된 텍스트 내용과 학생 정보를 종합적으로 분석하여, 교사가 이 학생을 효과적으로 지도할 수 있도록 구체적이고 실용적인 피드백을 존댓말로 작성해주세요.
      `;
      
      const textPart = { text: prompt };

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [audioPart, textPart] },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              transcription: {
                type: Type.STRING,
                description: '오디오를 텍스트로 변환한 내용',
              },
              feedback: {
                type: Type.STRING,
                description: '학생 지도를 위한 교사 피드백',
              },
            },
            required: ["transcription", "feedback"],
          },
        },
      });

      const jsonResponse = JSON.parse(response.text);

      const newCounsel: Counsel = {
        id: Date.now().toString(),
        date: new Date().toLocaleString('ko-KR'),
        audio: audioBlob,
        transcription: jsonResponse.transcription,
        feedback: jsonResponse.feedback,
      };

      setStudents(prev => prev.map(s =>
        s.id === selectedStudentId
          ? { ...s, counsels: [newCounsel, ...s.counsels] }
          : s
      ));
      setAudioBlob(null);

    } catch (error) {
      console.error("AI 분석 중 오류 발생:", error);
      alert("AI 분석에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveEducationData = ({ studentId, counselId, image, notes }: { studentId: string; counselId: string; image: string | null; notes: string; }) => {
    setStudents(prev => prev.map(student => {
        if (student.id !== studentId) return student;
        return {
            ...student,
            counsels: student.counsels.map(counsel => {
                if (counsel.id !== counselId) return counsel;
                return {
                    ...counsel,
                    reflectionImage: image || undefined,
                    educationalNotes: notes,
                };
            }),
        };
    }));
  };

  const selectedStudent = students.find(s => s.id === selectedStudentId);

  return (
    <div className="app-container">
      <header>
        <h1>AI 학생 상담 관리</h1>
      </header>
      <div className="tabs">
        <button className={`tab ${activeTab === 'register' ? 'active' : ''}`} onClick={() => setActiveTab('register')}>
          학생 등록
        </button>
        <button className={`tab ${activeTab === 'log' ? 'active' : ''}`} onClick={() => setActiveTab('log')}>
          상담 일지
        </button>
        <button className={`tab ${activeTab === 'education' ? 'active' : ''}`} onClick={() => setActiveTab('education')}>
          상담 결과 및 교육
        </button>
      </div>
      <main className="tab-content">
        {activeTab === 'register' && <RegisterView students={students} onAddStudent={handleAddStudent} onUpdateStudent={handleUpdateStudent}/>}
        {activeTab === 'log' && (
          <div className="log-container">
            {(!isMobile || !selectedStudentId) && (
              <div className="student-list-container">
                <h2>학생 명단</h2>
                <ul className="student-list">
                  {students.map(student => (
                    <li
                      key={student.id}
                      className={`student-list-item ${selectedStudentId === student.id ? 'selected' : ''}`}
                      onClick={() => {
                          setSelectedStudentId(student.id);
                          setExpandedCounselId(null);
                      }}
                    >
                      {student.class}반 {student.number}번 {student.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(!isMobile || selectedStudentId) && (
              <div className="counseling-details-container">
                {isMobile && selectedStudentId && (
                  <button className="btn btn-back" onClick={() => setSelectedStudentId(null)}>
                    ← 학생 목록으로
                  </button>
                )}
                {selectedStudent ? (
                  <>
                    <h2>{selectedStudent.name} 학생 상담 기록</h2>
                    <div className="counseling-controls">
                      {!isRecording && (
                        <button className="btn btn-primary" onClick={startRecording} disabled={isLoading}>
                          상담 녹음 시작
                        </button>
                      )}
                      {isRecording && (
                        <button className="btn btn-danger" onClick={stopRecording}>
                          녹음 중지
                        </button>
                      )}
                      {audioBlob && !isLoading && (
                        <button className="btn btn-secondary" onClick={handleTranscribeAndFeedback}>
                          AI로 전사 및 피드백 생성
                        </button>
                      )}
                      {isLoading && <div className="loading-indicator"><div className="spinner"></div>AI가 분석 중입니다...</div>}
                    </div>
                    <div className="counseling-log">
                      {selectedStudent.counsels.length > 0 ? selectedStudent.counsels.map(counsel => {
                        const isExpanded = expandedCounselId === counsel.id;
                        return(
                        <div key={counsel.id} className={`counseling-entry ${isExpanded ? 'expanded' : ''}`} onClick={() => setExpandedCounselId(isExpanded ? null : counsel.id)}>
                          <div className="counseling-entry-header">
                              <h4>상담일시: {counsel.date}</h4>
                              {!isExpanded && <p className="counseling-preview">{counsel.transcription.split('\n')[0]}</p>}
                          </div>
                          <div className="counseling-content">
                            <div className="transcription">
                              <h5>상담 내용 (전사)</h5>
                              <p>{counsel.transcription}</p>
                            </div>
                            <div className="feedback">
                              <h5>AI 지도 피드백</h5>
                              <p>{counsel.feedback}</p>
                            </div>
                          </div>
                        </div>
                        )
                      }) : <p className="placeholder-text">이 학생에 대한 상담 기록이 아직 없습니다.</p>}
                    </div>
                  </>
                ) : (
                  <div className="placeholder">학생 명단에서 학생을 선택해주세요.</div>
                )}
              </div>
            )}
          </div>
        )}
        {activeTab === 'education' && (
            <EducationView
                students={students}
                onSave={handleSaveEducationData}
                isMobile={isMobile}
            />
        )}
      </main>
    </div>
  );
};

const RegisterView = ({ students, onAddStudent, onUpdateStudent }: { 
    students: Student[], 
    onAddStudent: (student: Omit<Student, 'id' | 'counsels'>) => void,
    onUpdateStudent: (student: Student) => void
}) => {
  const [formData, setFormData] = useState({
    class: '',
    number: '',
    name: '',
    mbti: '',
    notes: '',
  });
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);

  const editingStudent = students.find(s => s.id === editingStudentId);

  const handleStudentSelect = (studentId: string) => {
    const studentToEdit = students.find(s => s.id === studentId);
    if (studentToEdit) {
      setEditingStudentId(studentId);
      setFormData({
        class: studentToEdit.class,
        number: studentToEdit.number,
        name: studentToEdit.name,
        mbti: studentToEdit.mbti,
        notes: studentToEdit.notes,
      });
    }
  };

  const handleCancelEdit = () => {
    setEditingStudentId(null);
    setFormData({ class: '', number: '', name: '', mbti: '', notes: '' });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.class || !formData.number || !formData.name) {
      alert('반, 번호, 이름은 필수 항목입니다.');
      return;
    }
    
    if (editingStudent) {
      onUpdateStudent({
        ...editingStudent,
        ...formData,
      });
    } else {
      onAddStudent(formData);
    }
    handleCancelEdit();
  };

  return (
    <div className="register-container">
      <div className="student-list-container">
        <h2>전체 학생 명단</h2>
        <ul className="student-list">
            {students.length > 0 ? students.map(student => (
              <li 
                key={student.id} 
                className={`student-list-item ${editingStudentId === student.id ? 'selected' : ''}`}
                onClick={() => handleStudentSelect(student.id)}
              >
                {student.class}반 {student.number}번 {student.name}
              </li>
            )) : (
                <p className="placeholder-text">등록된 학생이 없습니다.</p>
            )}
        </ul>
      </div>
      <div className="form-container">
        <h2>{editingStudent ? `${editingStudent.name} 학생 정보 수정` : '신규 학생 등록'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
              <div className="form-group">
                <label htmlFor="class">반</label>
                <input type="text" id="class" name="class" value={formData.class} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label htmlFor="number">번호</label>
                <input type="number" id="number" name="number" value={formData.number} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label htmlFor="name">이름</label>
                <input type="text" id="name" name="name" value={formData.name} onChange={handleChange} required />
              </div>
          </div>
          <div className="form-group">
            <label htmlFor="mbti">MBTI</label>
            <input type="text" id="mbti" name="mbti" value={formData.mbti} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label htmlFor="notes">성격 특성 및 특이점</label>
            <textarea id="notes" name="notes" value={formData.notes} onChange={handleChange}></textarea>
          </div>
          <div className="form-buttons">
            <button type="submit" className="btn btn-primary">{editingStudent ? '수정하기' : '등록하기'}</button>
            {editingStudent && (
              <button type="button" className="btn btn-neutral" onClick={handleCancelEdit}>취소</button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

const EducationView = ({ students, onSave, isMobile }: { students: Student[], onSave: (data: { studentId: string; counselId: string; image: string | null; notes: string; }) => void, isMobile: boolean }) => {
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedCounselId, setSelectedCounselId] = useState<string | null>(null);

  const [image, setImage] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [isModified, setIsModified] = useState(false);

  const selectedStudent = students.find(s => s.id === selectedStudentId);
  const selectedCounsel = selectedStudent?.counsels.find(c => c.id === selectedCounselId);

  useEffect(() => {
    if (selectedCounsel) {
      setImage(selectedCounsel.reflectionImage || null);
      setNotes(selectedCounsel.educationalNotes || '');
      setIsModified(false); // Reset modification status on selection change
    } else {
      setImage(null);
      setNotes('');
    }
  }, [selectedCounsel]);

  const handleStudentClick = (studentId: string | null) => {
    setSelectedStudentId(studentId);
    setSelectedCounselId(null);
  };
  
  const handleCounselClick = (counselId: string) => {
    setSelectedCounselId(counselId);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
        setIsModified(true);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNotes(e.target.value);
    setIsModified(true);
  };

  const handleSave = () => {
    if (!selectedStudentId || !selectedCounselId || !isModified) return;
    onSave({
      studentId: selectedStudentId,
      counselId: selectedCounselId,
      image: image,
      notes: notes,
    });
    setIsModified(false);
    alert('저장되었습니다.');
  };

  const renderStudentList = () => (
    <div className="student-list-container">
        <h2>학생 명단</h2>
        <ul className="student-list">
            {students.map(student => (
                <li key={student.id} 
                    className={`student-list-item ${selectedStudentId === student.id ? 'selected' : ''}`}
                    onClick={() => handleStudentClick(student.id)}
                    aria-current={selectedStudentId === student.id}
                >
                    {student.class}반 {student.number}번 {student.name}
                </li>
            ))}
        </ul>
    </div>
  );

  const renderCounselList = () => {
    if (!selectedStudent) return null;
    return (
        <div className="counseling-details-container">
            {isMobile && <button className="btn btn-back" onClick={() => handleStudentClick(null)}>← 학생 목록으로</button>}
            <h2>{selectedStudent.name} 학생 상담 날짜</h2>
            {selectedStudent.counsels.length > 0 ? (
                <ul className="student-list">
                    {selectedStudent.counsels.map(counsel => (
                        <li key={counsel.id} className="student-list-item" onClick={() => handleCounselClick(counsel.id)}>
                            {counsel.date}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="placeholder-text">이 학생에 대한 상담 기록이 없습니다. 먼저 상담 일지를 작성해주세요.</p>
            )}
        </div>
    );
  };
  
  const renderEducationForm = () => {
    if (!selectedStudent || !selectedCounsel) return null;
    return (
        <div className="counseling-details-container">
             {isMobile && <button className="btn btn-back" onClick={() => setSelectedCounselId(null)}>← 상담 날짜 목록으로</button>}
            <div className="education-form">
                <h3>{selectedStudent.name} - {selectedCounsel.date}</h3>
                <div className="form-group">
                    <label htmlFor="reflection-upload">반성문/성찰문 업로드</label>
                    <input className="file-input" type="file" id="reflection-upload" accept="image/*" onChange={handleImageChange} />
                    {image && (
                        <div className="image-preview-container">
                            <img src={image} alt="반성문 미리보기" className="image-preview" />
                        </div>
                    )}
                </div>
                <div className="form-group">
                    <label htmlFor="education-notes">교육 내용</label>
                    <textarea 
                        id="education-notes" 
                        value={notes} 
                        onChange={handleNotesChange} 
                        placeholder="학생에게 전달한 교육 내용이나 추가적인 메모를 입력하세요."
                    />
                </div>
                <button 
                    onClick={handleSave} 
                    className={`btn ${!isModified ? 'btn-saved' : 'btn-primary'}`}
                    disabled={!isModified}
                >
                    {!isModified ? '완료' : '저장하기'}
                </button>
            </div>
        </div>
    );
  };

  if (isMobile) {
    let content;
    if (!selectedStudentId) {
      content = renderStudentList();
    } else if (!selectedCounselId) {
      content = renderCounselList();
    } else {
      content = renderEducationForm();
    }
    return <div className="log-container">{content}</div>
  }

  return (
    <div className="log-container">
        {renderStudentList()}
        {!selectedStudent && <div className="counseling-details-container"><div className="placeholder">학생 명단에서 학생을 선택해주세요.</div></div>}
        {selectedStudent && !selectedCounselId && renderCounselList()}
        {selectedStudent && selectedCounselId && renderEducationForm()}
    </div>
  );
};


const root = createRoot(document.getElementById('root')!);
root.render(<App />);